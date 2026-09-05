// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// Supabase Edge Functions run under Deno and resolve the URL imports below at deployment time.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, isAllowedCorsOrigin } from "../_shared/cors.ts";

type RefundRequest = { refundId?: unknown; paymentId?: unknown };
type Refund = {
  id: string;
  payment_id: string;
  booking_id: string;
  provider: string;
  provider_refund_id: string | null;
  status: string;
  amount: number | string;
  currency_code: string;
  idempotency_key: string;
};

type Payment = {
  id: string;
  provider_payment_id: string;
  status: string;
  amount: number | string;
  currency_code: string;
};

type RazorpayPayment = {
  id?: unknown;
  status?: unknown;
  amount?: unknown;
  currency?: unknown;
};

type RazorpayRefund = {
  id?: unknown;
  payment_id?: unknown;
  amount?: unknown;
  currency?: unknown;
  status?: unknown;
};

function json(request: Request, body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders(request) });
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function providerRequest(path: string, keyId: string, keySecret: string, init?: RequestInit) {
  return fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
      ...init?.headers,
    },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return isAllowedCorsOrigin(request)
      ? new Response(null, { status: 204, headers: corsHeaders(request) })
      : new Response(null, { status: 403 });
  }
  if (request.method !== "POST") return json(request, { error: "Method not allowed" }, 405);
  if (request.headers.has("origin") && !isAllowedCorsOrigin(request)) return new Response(null, { status: 403 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const razorpayKeyId = Deno.env.get("RAZORPAY_KEY_ID");
  const razorpayKeySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
  if (!supabaseUrl || !publishableKey || !serviceRoleKey || !razorpayKeyId || !razorpayKeySecret) {
    return json(request, { error: "Refund service is not configured" }, 503);
  }

  const authorization = request.headers.get("authorization");
  if (!authorization) return json(request, { error: "Authentication required" }, 401);

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json(request, { error: "Authentication required" }, 401);

  const body = await request.json().catch(() => null) as RefundRequest | null;
  if (!isUuid(body?.refundId) && !isUuid(body?.paymentId)) {
    return json(request, { error: "A valid refund or payment ID is required" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let refundQuery = admin.from("refunds")
    .select("id,payment_id,booking_id,provider,provider_refund_id,status,amount,currency_code,idempotency_key");
  refundQuery = isUuid(body?.refundId)
    ? refundQuery.eq("id", body.refundId)
    : refundQuery.eq("payment_id", body!.paymentId).order("created_at", { ascending: false }).limit(1);
  const [{ data: profile, error: profileError }, { data: storedRefund, error: refundError }] = await Promise.all([
    admin.from("profiles").select("role").eq("id", user.id).maybeSingle<{ role: string }>(),
    refundQuery.maybeSingle<Refund>(),
  ]);
  if (profileError || !profile) return json(request, { error: "Authentication required" }, 401);
  if (refundError || !storedRefund || storedRefund.provider !== "razorpay") return json(request, { error: "Refund not found" }, 404);

  const [{ data: booking, error: bookingError }, { data: payment, error: paymentError }] = await Promise.all([
    admin.from("bookings")
      .select("property_id,properties!inner(host_id)")
      .eq("id", storedRefund.booking_id)
      .maybeSingle<{ property_id: string; properties: { host_id: string | null } | { host_id: string | null }[] }>(),
    admin.from("payments")
      .select("id,provider_payment_id,status,amount,currency_code")
      .eq("id", storedRefund.payment_id)
      .maybeSingle<Payment>(),
  ]);
  if (bookingError || !booking || paymentError || !payment) return json(request, { error: "Refund not found" }, 404);
  const property = Array.isArray(booking.properties) ? booking.properties[0] : booking.properties;
  if (profile.role !== "admin" && property?.host_id !== user.id) return json(request, { error: "Forbidden" }, 403);

  if (storedRefund.status === "completed" && storedRefund.provider_refund_id) {
    return json(request, { refundId: storedRefund.provider_refund_id, status: "processed", duplicate: true });
  }
  if (!(["requested", "failed"] as string[]).includes(storedRefund.status)) {
    return json(request, { error: "Refund is already being processed" }, 409);
  }
  if (!(["captured", "partially_refunded"] as string[]).includes(payment.status)) {
    return json(request, { error: "Refund requires a captured payment" }, 409);
  }

  const capturedAmount = Math.round(Number(payment.amount) * 100);
  const refundAmount = Math.round(Number(storedRefund.amount) * 100);
  if (!Number.isSafeInteger(capturedAmount) || !Number.isSafeInteger(refundAmount) || refundAmount < 1 || refundAmount > capturedAmount) {
    return json(request, { error: "Invalid stored refund amount" }, 409);
  }

  const { data: claimedRefund, error: claimError } = await admin
    .from("refunds")
    .update({ status: "processing", failure_reason: null, updated_at: new Date().toISOString() })
    .eq("id", storedRefund.id)
    .in("status", ["requested", "failed"])
    .select("id")
    .maybeSingle<{ id: string }>();
  if (claimError) return json(request, { error: "Unable to claim refund" }, 503);
  if (!claimedRefund) return json(request, { error: "Refund is already being processed" }, 409);

  const failRefund = async (reason: string) => {
    await admin.from("refunds").update({
      status: "failed",
      failure_reason: reason.slice(0, 1000),
      updated_at: new Date().toISOString(),
    }).eq("id", storedRefund.id).eq("status", "processing");
  };

  const providerPaymentResponse = await providerRequest(`/payments/${encodeURIComponent(payment.provider_payment_id)}`, razorpayKeyId, razorpayKeySecret);
  if (!providerPaymentResponse.ok) {
    await failRefund(`Unable to verify captured payment (${providerPaymentResponse.status})`);
    return json(request, { error: "Unable to verify captured payment" }, 502);
  }
  const providerPayment = await providerPaymentResponse.json() as RazorpayPayment;
  if (
    providerPayment.id !== payment.provider_payment_id ||
    providerPayment.status !== "captured" ||
    providerPayment.amount !== capturedAmount ||
    providerPayment.currency !== payment.currency_code ||
    storedRefund.currency_code !== payment.currency_code
  ) {
    await failRefund("Stored payment does not match the captured provider payment");
    return json(request, { error: "Stored payment does not match the captured provider payment" }, 409);
  }

  const refundResponse = await providerRequest(
    `/payments/${encodeURIComponent(payment.provider_payment_id)}/refund`,
    razorpayKeyId,
    razorpayKeySecret,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Razorpay-Idempotency-Key": storedRefund.idempotency_key,
      },
      body: JSON.stringify({
        amount: refundAmount,
        notes: {
          booking_id: storedRefund.booking_id,
          payment_record_id: payment.id,
          refund_id: storedRefund.id,
        },
      }),
    },
  );
  if (!refundResponse.ok) {
    await failRefund(`Refund provider returned ${refundResponse.status}`);
    return json(request, { error: "Unable to create refund" }, 502);
  }

  const providerRefund = await refundResponse.json() as RazorpayRefund;
  if (
    typeof providerRefund.id !== "string" || !providerRefund.id ||
    providerRefund.payment_id !== payment.provider_payment_id ||
    providerRefund.amount !== refundAmount ||
    providerRefund.currency !== storedRefund.currency_code ||
    (providerRefund.status !== "pending" && providerRefund.status !== "processed")
  ) {
    await failRefund("Refund provider returned an invalid response");
    return json(request, { error: "Invalid refund provider response" }, 502);
  }

  if (providerRefund.status === "pending") {
    const { error: pendingUpdateError } = await admin.from("refunds").update({
      provider_refund_id: providerRefund.id,
      provider_payload: providerRefund,
      updated_at: new Date().toISOString(),
    }).eq("id", storedRefund.id).eq("status", "processing");
    if (pendingUpdateError) {
      console.error("Refund was accepted but could not be recorded locally", { code: pendingUpdateError.code, refundId: storedRefund.id });
      return json(request, { error: "Refund accepted; reconciliation is pending" }, 503);
    }
  } else {
    const { error: completionError } = await admin.rpc("complete_refund", {
      p_refund_id: storedRefund.id,
      p_provider_refund_id: providerRefund.id,
      p_idempotency_key: storedRefund.idempotency_key,
      p_provider_payload: providerRefund,
    });
    if (completionError) {
      console.error("Refund was processed but could not be completed locally", { code: completionError.code, refundId: storedRefund.id });
      return json(request, { error: "Refund processed; reconciliation is pending" }, 503);
    }
  }

  return json(request, { refundId: providerRefund.id, status: providerRefund.status }, 201);
});
