// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// Supabase Edge Functions run under Deno and resolve the URL imports below at deployment time.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, isAllowedCorsOrigin } from "../_shared/cors.ts";

type NotificationJob = {
  id: string;
  recipient_id: string | null;
  channel: string;
  template_key: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

function json(request: Request, body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders(request) });
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

const PROVIDER_TIMEOUT_MS = 10_000;
const MAX_PAYLOAD_TEXT_LENGTH = 200;
const WEBHOOK_TEMPLATES = new Set([
  "support_case_created",
  "support_case_customer_reply",
  "support_case_resolved",
]);

function payloadText(job: NotificationJob, name: string) {
  const value = job.payload?.[name];
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, MAX_PAYLOAD_TEXT_LENGTH)
    : null;
}

function payloadReference(job: NotificationJob, name: string, fallback: string) {
  const value = job.payload?.[name];
  if ((typeof value === "string" || typeof value === "number") && String(value).trim()) {
    return String(value).trim().slice(0, MAX_PAYLOAD_TEXT_LENGTH);
  }
  return fallback;
}

function renderEmail(job: NotificationJob) {
  const bookingId = payloadReference(job, "booking_id", "your booking");
  const reviewId = payloadReference(job, "review_id", "your review");
  const supportCaseId = payloadReference(job, "support_case_id", "your support case");
  const amount = job.payload?.amount;
  const currency = payloadText(job, "currency_code") ?? "INR";
  const formattedAmount = typeof amount === "number" || typeof amount === "string"
    ? `${currency} ${String(amount).slice(0, MAX_PAYLOAD_TEXT_LENGTH)}`
    : null;

  switch (job.template_key) {
    case "booking_hold_expired":
      return { subject: "Your booking hold expired", text: `Your hold for booking ${bookingId} expired before payment was completed.` };
    case "booking_cancelled_guest":
      return { subject: "Your booking was cancelled", text: `Booking ${bookingId} was cancelled.${formattedAmount ? ` Refund due: ${formattedAmount}.` : ""}` };
    case "booking_cancelled_host":
      return { subject: "A booking was cancelled", text: `Booking ${bookingId} was cancelled.` };
    case "booking_completed_guest":
      return { subject: "Your stay is complete", text: `Your stay for booking ${bookingId} is complete. You can now leave a review.` };
    case "refund_completed":
      return { subject: "Your refund was completed", text: `Your refund${formattedAmount ? ` of ${formattedAmount}` : ""} for booking ${bookingId} was completed.` };
    case "host_payout_created":
      return { subject: "A host payout was created", text: `A payout${formattedAmount ? ` of ${formattedAmount}` : ""} was created for booking ${bookingId}.` };
    case "review_submitted_host":
      return { subject: "A new review was submitted", text: `Review ${reviewId} for booking ${bookingId} was submitted and is awaiting moderation.` };
    case "review_moderated_guest": {
      const decision = payloadText(job, "decision");
      const outcome = decision === "approved" ? "approved" : decision === "rejected" ? "not approved" : "moderated";
      return { subject: "Your review was moderated", text: `Review ${reviewId} for booking ${bookingId} was ${outcome}.` };
    }
    case "review_approved_guest":
      return { subject: "Your review was approved", text: `Review ${reviewId} for booking ${bookingId} was approved and published.` };
    case "review_rejected_guest":
      return { subject: "Your review was not approved", text: `Review ${reviewId} for booking ${bookingId} was not approved for publication.` };
    case "review_host_response_guest":
      return { subject: "A host responded to your review", text: `The host responded to review ${reviewId} for booking ${bookingId}.` };
    case "support_case_reply":
      return { subject: "New reply to your support case", text: `The support team replied to support case ${supportCaseId}.` };
    case "support_case_customer_reply":
      return { subject: "New customer reply to a support case", text: `A customer replied to support case ${supportCaseId}.` };
    case "support_case_resolved":
      return { subject: "Your support case was resolved", text: `Support case ${supportCaseId} was resolved.` };
    default:
      throw new Error("Unsupported notification template");
  }
}

async function providerFetch(url: string, init: RequestInit, provider: "Email" | "Webhook") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    throw new Error(`${provider} provider request failed`);
  } finally {
    clearTimeout(timeout);
  }
}

async function deliverEmail(job: NotificationJob, to: string, apiKey: string, from: string) {
  const { subject, text } = renderEmail(job);
  const response = await providerFetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `notification/${job.id}`,
    },
    body: JSON.stringify({ from, to: [to], subject, text }),
  }, "Email");
  if (!response.ok) throw new Error(`Email provider returned ${response.status}`);

  let result: { id?: unknown };
  try {
    result = await response.json() as { id?: unknown };
  } catch {
    throw new Error("Email provider returned an invalid response");
  }
  if (typeof result.id !== "string" || !result.id) throw new Error("Email provider returned an invalid response");
}

function renderWebhookPayload(job: NotificationJob) {
  if (!WEBHOOK_TEMPLATES.has(job.template_key)) throw new Error("Unsupported notification template");

  const supportCaseId = payloadText(job, "support_case_id");
  if (!supportCaseId) throw new Error("Webhook payload is invalid");
  const payload: Record<string, string> = { support_case_id: supportCaseId };
  for (const name of ["message_id", "priority", "category"]) {
    const value = payloadText(job, name);
    if (value) payload[name] = value;
  }
  return payload;
}

async function deliverWebhook(job: NotificationJob, url: string, secret: string | undefined) {
  let endpoint: URL;
  try {
    endpoint = new URL(url);
  } catch {
    throw new Error("Webhook delivery is not configured");
  }
  if (endpoint.protocol !== "https:") throw new Error("Webhook delivery is not configured");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Idempotency-Key": `notification/${job.id}`,
  };
  if (secret) headers["X-Support-Webhook-Secret"] = secret;

  const response = await providerFetch(endpoint.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify({
      event: job.template_key,
      notification_id: job.id,
      payload: renderWebhookPayload(job),
    }),
  }, "Webhook");
  if (!response.ok) throw new Error(`Webhook provider returned ${response.status}`);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return isAllowedCorsOrigin(request)
      ? new Response(null, { status: 204, headers: corsHeaders(request) })
      : new Response(null, { status: 403 });
  }
  if (request.method !== "POST") return json(request, { error: "Method not allowed" }, 405);
  if (request.headers.has("origin") && !isAllowedCorsOrigin(request)) return new Response(null, { status: 403 });

  const cronSecret = Deno.env.get("CRON_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("EMAIL_FROM");
  const supportWebhookUrl = Deno.env.get("SUPPORT_WEBHOOK_URL");
  const supportWebhookSecret = Deno.env.get("SUPPORT_WEBHOOK_SECRET");
  if (!cronSecret || !supabaseUrl || !serviceRoleKey) {
    return json(request, { error: "Notification service is not configured" }, 503);
  }
  if (!hasCronSecret(request, cronSecret)) return json(request, { error: "Unauthorized" }, 401);

  const requestedLimit = Number(new URL(request.url).searchParams.get("limit") ?? "20");
  const batchSize = Number.isSafeInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 20;
  const workerId = crypto.randomUUID();
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString();
  const { error: recoveryError } = await admin
    .from("notification_outbox")
    .update({ status: "failed", locked_at: null, locked_by: null, last_error: "Worker lease expired", available_at: now })
    .eq("status", "processing")
    .lt("locked_at", staleBefore);
  if (recoveryError) {
    console.error("Unable to recover stale notification jobs", { code: recoveryError.code });
    return json(request, { error: "Unable to recover notification jobs" }, 503);
  }

  const { data: candidates, error: candidateError } = await admin
    .from("notification_outbox")
    .select("id,recipient_id,channel,template_key,payload,attempts,max_attempts")
    .in("status", ["pending", "failed"])
    .lte("available_at", now)
    .order("available_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(batchSize * 2);
  if (candidateError) {
    console.error("Unable to load notification jobs", { code: candidateError.code });
    return json(request, { error: "Unable to claim notification jobs" }, 503);
  }

  const jobs: NotificationJob[] = [];
  for (const candidate of (candidates ?? []) as NotificationJob[]) {
    if (jobs.length >= batchSize) break;
    if (candidate.attempts >= candidate.max_attempts) {
      await admin.from("notification_outbox").update({ status: "dead", locked_at: null, locked_by: null })
        .eq("id", candidate.id).in("status", ["pending", "failed"]);
      continue;
    }
    const { data: claimed, error: claimError } = await admin
      .from("notification_outbox")
      .update({
        status: "processing",
        attempts: candidate.attempts + 1,
        locked_at: now,
        locked_by: workerId,
        last_error: null,
        updated_at: now,
      })
      .eq("id", candidate.id)
      .eq("attempts", candidate.attempts)
      .in("status", ["pending", "failed"])
      .select("id,recipient_id,channel,template_key,payload,attempts,max_attempts")
      .maybeSingle<NotificationJob>();
    if (claimError) {
      console.error("Unable to claim notification job", { code: claimError.code, jobId: candidate.id });
      continue;
    }
    if (claimed) jobs.push(claimed);
  }

  let sent = 0;
  let failed = 0;
  for (const job of jobs) {
    let deliveryError: string | null = null;
    try {
      if (job.channel === "email") {
        if (!resendApiKey || !fromEmail) throw new Error("Email delivery is not configured");
        if (!job.recipient_id) throw new Error("Notification recipient is missing");
        const { data: recipient, error: recipientError } = await admin.auth.admin.getUserById(job.recipient_id);
        if (recipientError || !recipient.user?.email) throw new Error("Notification recipient has no email address");
        await deliverEmail(job, recipient.user.email, resendApiKey, fromEmail);
      } else if (job.channel === "webhook") {
        if (!supportWebhookUrl) throw new Error("Webhook delivery is not configured");
        await deliverWebhook(job, supportWebhookUrl, supportWebhookSecret);
      } else {
        throw new Error("Unsupported notification channel");
      }
      sent += 1;
    } catch (error) {
      deliveryError = error instanceof Error ? error.message.slice(0, 500) : "Notification delivery failed";
      failed += 1;
    }

    const succeeded = deliveryError === null;
    const exhausted = job.attempts >= job.max_attempts;
    const retryAt = new Date(Date.now() + Math.min(2 ** job.attempts * 60_000, 24 * 60 * 60_000)).toISOString();
    const { error: attemptError } = await admin
      .from("notification_outbox")
      .update(succeeded
        ? { status: "sent", sent_at: new Date().toISOString(), locked_at: null, locked_by: null, last_error: null }
        : {
          status: exhausted ? "dead" : "failed",
          available_at: retryAt,
          locked_at: null,
          locked_by: null,
          last_error: deliveryError,
        })
      .eq("id", job.id)
      .eq("status", "processing")
      .eq("locked_by", workerId);
    if (attemptError) {
      console.error("Unable to mark notification attempt", { code: attemptError.code, jobId: job.id });
      return json(request, { error: "Unable to record notification delivery attempt", sent, failed }, 503);
    }
  }

  return json(request, { claimed: jobs.length, sent, failed });
});
