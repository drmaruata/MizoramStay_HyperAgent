// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// Supabase Edge Functions run under Deno and resolve the URL imports below at deployment time.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

type JsonObject = Record<string, unknown>;
type Payout = {
  id: string;
  booking_id: string;
  provider: string;
  provider_payout_id: string | null;
  payout_account_ref: string;
  status: string;
  amount: number | string;
  currency_code: string;
  idempotency_key: string;
  provider_payload: JsonObject;
  updated_at: string;
};

type RazorpayPayout = {
  id?: unknown;
  entity?: unknown;
  fund_account_id?: unknown;
  amount?: unknown;
  currency?: unknown;
  status?: unknown;
  reference_id?: unknown;
  mode?: unknown;
};

const MAX_ATTEMPTS = 8;
const MAX_BATCH_SIZE = 25;
const REQUEST_TIMEOUT_MS = 20_000;
const TERMINAL_FAILURE_DELAY_MS = 365 * 24 * 60 * 60_000;

function json(request: Request, body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      ...corsHeaders(request),
      "Cache-Control": "no-store",
    },
  });
}

function hasCronSecret(request: Request, expected: string) {
  const supplied = request.headers.get("x-cron-secret") ?? request.headers.get("cron-secret");
  if (!supplied || supplied.length !== expected.length) return false;

  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= supplied.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function attemptsFor(payout: Payout) {
  const worker = isObject(payout.provider_payload?.payout_worker)
    ? payout.provider_payload.payout_worker
    : null;
  const attempts = worker?.attempts;
  return Number.isSafeInteger(attempts) && attempts >= 0 ? attempts : 0;
}

function toMinorUnits(value: number | string) {
  const normalized = String(value).trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;

  const amount = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function providerPayload(payout: Payout, attempts: number, values: JsonObject = {}) {
  return {
    ...(isObject(payout.provider_payload) ? payout.provider_payload : {}),
    payout_worker: {
      attempts,
      provider_api: "razorpay_x_payouts_v1",
      ...values,
    },
  };
}

function retryAt(attempts: number, retryable: boolean) {
  const delay = retryable
    ? Math.min(2 ** attempts * 60_000, 24 * 60 * 60_000)
    : TERMINAL_FAILURE_DELAY_MS;
  return new Date(Date.now() + delay).toISOString();
}

async function createRazorpayPayout(
  payout: Payout,
  amount: number,
  sourceAccountNumber: string,
  mode: string,
  keyId: string,
  keySecret: string,
) {
  const response = await fetch("https://api.razorpay.com/v1/payouts", {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
      "Content-Type": "application/json",
      // Razorpay accepts 4-36 safe characters. The payout UUID is the durable provider
      // request key; the longer business idempotency key remains durable in the row.
      "X-Payout-Idempotency": payout.id,
    },
    body: JSON.stringify({
      account_number: sourceAccountNumber,
      fund_account_id: payout.payout_account_ref,
      amount,
      currency: payout.currency_code,
      mode,
      purpose: "payout",
      queue_if_low_balance: false,
      reference_id: payout.id,
      narration: "MizoramStay host payout",
      notes: {
        payout_id: payout.id,
        booking_id: payout.booking_id,
      },
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
    throw new ProviderError(`Razorpay Payout API returned ${response.status}`, retryable, response.status);
  }

  let result: RazorpayPayout;
  try {
    result = await response.json() as RazorpayPayout;
  } catch {
    throw new ProviderError("Razorpay Payout API returned invalid JSON", true, response.status);
  }

  const acceptedStatuses = ["queued", "pending", "processing", "processed"];
  if (
    typeof result.id !== "string" || !/^pout_[A-Za-z0-9]+$/.test(result.id) ||
    result.entity !== "payout" ||
    result.fund_account_id !== payout.payout_account_ref ||
    result.amount !== amount ||
    result.currency !== payout.currency_code ||
    result.reference_id !== payout.id ||
    result.mode !== mode ||
    typeof result.status !== "string" || !acceptedStatuses.includes(result.status)
  ) {
    throw new ProviderError("Razorpay Payout API returned an invalid payout", true, response.status);
  }

  return result as Required<Pick<RazorpayPayout, "id" | "status">> & RazorpayPayout;
}

class ProviderError extends Error {
  retryable: boolean;
  httpStatus: number | null;

  constructor(message: string, retryable: boolean, httpStatus: number | null = null) {
    super(message);
    this.name = "ProviderError";
    this.retryable = retryable;
    this.httpStatus = httpStatus;
  }
}

Deno.serve(async (request) => {
  // This is a server-to-server CRON endpoint. Browser-originated calls are rejected even
  // if an operator accidentally exposes CRON_SECRET to a browser environment.
  if (request.headers.has("origin")) return new Response(null, { status: 403 });
  if (request.method !== "POST") return json(request, { error: "Method not allowed" }, 405);

  const cronSecret = Deno.env.get("CRON_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const razorpayKeyId = Deno.env.get("RAZORPAY_KEY_ID");
  const razorpayKeySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
  const sourceAccountNumber = Deno.env.get("RAZORPAY_PAYOUT_ACCOUNT_NUMBER");
  const payoutMode = Deno.env.get("RAZORPAY_PAYOUT_MODE") ?? "IMPS";
  if (
    !cronSecret || !supabaseUrl || !serviceRoleKey || !razorpayKeyId || !razorpayKeySecret ||
    !sourceAccountNumber
  ) {
    return json(request, { error: "Payout service is not configured" }, 503);
  }
  if (!hasCronSecret(request, cronSecret)) return json(request, { error: "Unauthorized" }, 401);
  if (!/^\d{6,40}$/.test(sourceAccountNumber) || !["IMPS", "NEFT", "RTGS", "UPI"].includes(payoutMode)) {
    return json(request, { error: "Payout service configuration is invalid" }, 503);
  }

  // RazorpayX Payouts is used rather than Route Transfers because the existing schema
  // persists a beneficiary fund-account reference, not a linked Route account/payment.
  // Fail closed unless onboarding stored a RazorpayX `fa_...` fund_account_id and the
  // deployment has an activated RazorpayX source account with Payout API access.
  const requestedLimit = Number(new URL(request.url).searchParams.get("limit") ?? "10");
  const batchSize = Number.isSafeInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), MAX_BATCH_SIZE)
    : 10;
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const now = new Date().toISOString();
  const { data: candidates, error: candidateError } = await admin
    .from("host_payouts")
    .select("id,booking_id,provider,provider_payout_id,payout_account_ref,status,amount,currency_code,idempotency_key,provider_payload,updated_at")
    .in("status", ["pending", "failed"])
    .lte("available_at", now)
    .order("available_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(batchSize * 3);
  if (candidateError) {
    console.error("Unable to load payout jobs", { code: candidateError.code });
    return json(request, { error: "Unable to claim payout jobs" }, 503);
  }

  const payouts: Payout[] = [];
  for (const candidate of (candidates ?? []) as Payout[]) {
    if (payouts.length >= batchSize) break;

    const previousAttempts = attemptsFor(candidate);
    if (previousAttempts >= MAX_ATTEMPTS) {
      const { error: exhaustedError } = await admin.from("host_payouts").update({
        status: "failed",
        failure_reason: "Payout retry limit reached",
        available_at: retryAt(previousAttempts, false),
      }).eq("id", candidate.id).eq("updated_at", candidate.updated_at).in("status", ["pending", "failed"]);
      if (exhaustedError) {
        console.error("Unable to mark exhausted payout", { code: exhaustedError.code, payoutId: candidate.id });
      }
      continue;
    }

    const attempts = previousAttempts + 1;
    const { data: claimed, error: claimError } = await admin
      .from("host_payouts")
      .update({
        status: "processing",
        failure_reason: null,
        provider_payload: providerPayload(candidate, attempts, {
          claimed_at: now,
          provider_idempotency_key: candidate.id,
          last_http_status: null,
        }),
        updated_at: now,
      })
      .eq("id", candidate.id)
      .eq("updated_at", candidate.updated_at)
      .is("provider_payout_id", null)
      .in("status", ["pending", "failed"])
      .select("id,booking_id,provider,provider_payout_id,payout_account_ref,status,amount,currency_code,idempotency_key,provider_payload,updated_at")
      .maybeSingle<Payout>();
    if (claimError) {
      console.error("Unable to claim payout job", { code: claimError.code, payoutId: candidate.id });
      continue;
    }
    if (claimed) payouts.push(claimed);
  }

  let paid = 0;
  let submitted = 0;
  let failed = 0;
  for (const payout of payouts) {
    const attempts = attemptsFor(payout);
    let providerResult: (Required<Pick<RazorpayPayout, "id" | "status">> & RazorpayPayout) | null = null;
    let failure: ProviderError | null = null;

    try {
      if (payout.provider !== "razorpay") throw new ProviderError("Unsupported payout provider", false);
      if (!/^fa_[A-Za-z0-9]+$/.test(payout.payout_account_ref)) {
        throw new ProviderError("Host payout account is not an onboarded RazorpayX fund account", false);
      }
      if (payout.currency_code !== "INR") throw new ProviderError("RazorpayX payouts require INR", false);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payout.id)) {
        throw new ProviderError("Payout provider idempotency key is invalid", false);
      }
      if (!payout.idempotency_key || payout.idempotency_key.length > 255) {
        throw new ProviderError("Stored payout idempotency key is invalid", false);
      }

      const amount = toMinorUnits(payout.amount);
      if (amount === null) throw new ProviderError("Stored payout amount is invalid", false);
      providerResult = await createRazorpayPayout(
        payout,
        amount,
        sourceAccountNumber,
        payoutMode,
        razorpayKeyId,
        razorpayKeySecret,
      );
    } catch (error) {
      failure = error instanceof ProviderError
        ? error
        : new ProviderError(error instanceof Error ? error.message : "Payout provider request failed", true);
    }

    if (failure) {
      const exhausted = !failure.retryable || attempts >= MAX_ATTEMPTS;
      const reason = failure.message.slice(0, 1000) || "Payout processing failed";
      const { data: savedFailure, error: failureError } = await admin.from("host_payouts").update({
        status: "failed",
        failure_reason: reason,
        available_at: retryAt(attempts, !exhausted),
        provider_payload: providerPayload(payout, attempts, {
          failed_at: new Date().toISOString(),
          retryable: !exhausted,
          last_http_status: failure.httpStatus,
        }),
      }).eq("id", payout.id).eq("status", "processing").is("provider_payout_id", null).select("id").maybeSingle<{ id: string }>();
      if (failureError || !savedFailure) {
        console.error("Unable to record payout failure", { code: failureError?.code, payoutId: payout.id });
        return json(request, { error: "Unable to record payout attempt", claimed: payouts.length, paid, submitted, failed }, 503);
      }
      failed += 1;
      continue;
    }

    const isPaid = providerResult.status === "processed";
    const { data: saved, error: saveError } = await admin.from("host_payouts").update({
      provider_payout_id: providerResult.id,
      provider_payload: providerPayload(payout, attempts, {
        submitted_at: new Date().toISOString(),
        provider_status: providerResult.status,
        last_http_status: 200,
      }),
      status: isPaid ? "paid" : "processing",
      paid_at: isPaid ? new Date().toISOString() : null,
      failure_reason: null,
    }).eq("id", payout.id).eq("status", "processing").is("provider_payout_id", null).select("id").maybeSingle<{ id: string }>();
    if (saveError || !saved) {
      // The provider accepted the durable idempotency key. Do not retry blindly here;
      // reconciliation by that key/provider response must resolve the local write first.
      console.error("Payout was accepted but could not be recorded locally", {
        code: saveError?.code,
        payoutId: payout.id,
      });
      return json(request, { error: "Payout accepted; reconciliation is required", claimed: payouts.length, paid, submitted, failed }, 503);
    }

    if (isPaid) paid += 1;
    else submitted += 1;
  }

  return json(request, { claimed: payouts.length, paid, submitted, failed });
});
