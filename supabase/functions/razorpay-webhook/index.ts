// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// Supabase Edge Functions run under Deno and resolve the URL imports below at deployment time.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, isAllowedCorsOrigin } from "../_shared/cors.ts";

type RazorpayEntity = {
  id?: unknown;
  order_id?: unknown;
  payment_id?: unknown;
  amount?: unknown;
  currency?: unknown;
  status?: unknown;
  error_code?: unknown;
  error_description?: unknown;
  notes?: { booking_id?: unknown; payment_record_id?: unknown; refund_id?: unknown };
};

type RazorpayWebhook = {
  event?: unknown;
  payload?: {
    payment?: { entity?: RazorpayEntity };
    refund?: { entity?: RazorpayEntity };
  };
};

type StoredPayment = {
  id: string;
  booking_id: string;
  provider_payment_id: string;
  status: string;
  amount: number | string;
  currency_code: string;
  provider_payload: Record<string, unknown> | null;
};

type StoredRefund = {
  id: string;
  payment_id: string;
  status: string;
  amount: number | string;
  currency_code: string;
  idempotency_key: string;
};

function json(request: Request, body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders(request) });
}

function hexToBytes(value: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function hasValidSignature(rawBody: string, signature: string, secret: string) {
  const signatureBytes = hexToBytes(signature);
  if (!signatureBytes) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, signatureBytes, new TextEncoder().encode(rawBody));
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return isAllowedCorsOrigin(request)
      ? new Response(null, { status: 204, headers: corsHeaders(request) })
      : new Response(null, { status: 403 });
  }
  if (request.method !== "POST") return json(request, { error: "Method not allowed" }, 405);
  if (request.headers.has("origin") && !isAllowedCorsOrigin(request)) return new Response(null, { status: 403 });

  const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const signature = request.headers.get("x-razorpay-signature");
  const eventId = request.headers.get("x-razorpay-event-id");
  if (!webhookSecret || !supabaseUrl || !serviceRoleKey) return json(request, { error: "Webhook service is not configured" }, 503);
  if (!signature || !eventId || eventId.length > 200) return json(request, { error: "Invalid webhook headers" }, 400);

  const rawBody = await request.text();
  if (!(await hasValidSignature(rawBody, signature, webhookSecret))) {
    return json(request, { error: "Invalid webhook signature" }, 401);
  }

  let webhook: RazorpayWebhook;
  try {
    webhook = JSON.parse(rawBody) as RazorpayWebhook;
  } catch {
    return json(request, { error: "Invalid webhook payload" }, 400);
  }
  if (typeof webhook.event !== "string" || webhook.event.length === 0 || webhook.event.length > 120) {
    return json(request, { error: "Invalid webhook event" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: eventError } = await admin.from("payment_webhook_events").insert({
    provider: "razorpay",
    event_id: eventId,
    event_type: webhook.event,
    payload: webhook,
  });
  if (eventError?.code === "23505") {
    const { data: existingEvent, error: existingEventError } = await admin
      .from("payment_webhook_events")
      .select("processed_at")
      .eq("provider", "razorpay")
      .eq("event_id", eventId)
      .maybeSingle<{ processed_at: string | null }>();
    if (existingEventError || !existingEvent) return json(request, { error: "Unable to load webhook event" }, 503);
    if (existingEvent.processed_at) return json(request, { received: true, duplicate: true });
  } else if (eventError) {
    return json(request, { error: "Unable to record webhook event" }, 503);
  }

  const markProcessed = async () => {
    const { error } = await admin
      .from("payment_webhook_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("provider", "razorpay")
      .eq("event_id", eventId);
    return error;
  };

  if (webhook.event === "payment.captured") {
    const payment = webhook.payload?.payment?.entity;
    const bookingId = payment?.notes?.booking_id;
    if (
      !isUuid(bookingId) ||
      typeof payment?.id !== "string" ||
      typeof payment.order_id !== "string" ||
      payment.status !== "captured" ||
      !Number.isSafeInteger(payment.amount) ||
      typeof payment.currency !== "string"
    ) {
      return json(request, { error: "Captured payment is missing required details" }, 422);
    }

    const { data: orderPayment, error: orderPaymentError } = await admin
      .from("payments")
      .select("id,booking_id,provider_payment_id,status,amount,currency_code,provider_payload")
      .eq("booking_id", bookingId)
      .eq("provider", "razorpay")
      .eq("provider_payment_id", payment.order_id)
      .eq("status", "pending")
      .maybeSingle<StoredPayment>();
    const expectedAmount = orderPayment ? Math.round(Number(orderPayment.amount) * 100) : Number.NaN;
    if (
      orderPaymentError ||
      !orderPayment ||
      !Number.isSafeInteger(expectedAmount) ||
      payment.amount !== expectedAmount ||
      payment.currency !== orderPayment.currency_code
    ) {
      return json(request, { error: "Captured payment does not match its order" }, 422);
    }

    const { error: confirmationError } = await admin.rpc("confirm_razorpay_payment", {
      p_booking_id: bookingId,
      p_order_id: payment.order_id,
      p_payment_id: payment.id,
      p_event_id: eventId,
    });
    if (confirmationError) return json(request, { error: "Unable to confirm payment" }, 409);

    return json(request, { received: true, processed: true });
  }

  if (webhook.event === "payment.failed") {
    const payment = webhook.payload?.payment?.entity;
    const bookingId = payment?.notes?.booking_id;
    if (!isUuid(bookingId) || typeof payment?.id !== "string" || typeof payment.order_id !== "string") {
      return json(request, { error: "Failed payment is missing booking details" }, 422);
    }

    const { data: failedPayment, error: failedPaymentError } = await admin
      .from("payments")
      .select("id,booking_id,provider_payment_id,status,amount,currency_code,provider_payload")
      .eq("booking_id", bookingId)
      .eq("provider", "razorpay")
      .eq("provider_payment_id", payment.order_id)
      .eq("status", "pending")
      .maybeSingle<StoredPayment>();
    if (failedPaymentError || !failedPayment) return json(request, { error: "Payment order was not found" }, 422);

    const { error: updateError } = await admin
      .from("payments")
      .update({
        provider_payment_id: payment.id,
        provider_payload: {
          ...(failedPayment.provider_payload ?? {}),
          order_id: payment.order_id,
          error_code: typeof payment.error_code === "string" ? payment.error_code : null,
          error_description: typeof payment.error_description === "string" ? payment.error_description : null,
        },
        status: "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", failedPayment.id)
      .eq("status", "pending");
    if (updateError) return json(request, { error: "Unable to record failed payment" }, 503);
    if (await markProcessed()) return json(request, { error: "Unable to complete webhook event" }, 503);
    return json(request, { received: true, processed: true });
  }

  if (webhook.event === "refund.processed") {
    const refund = webhook.payload?.refund?.entity;
    if (
      typeof refund?.id !== "string" ||
      typeof refund.payment_id !== "string" ||
      refund.status !== "processed" ||
      !Number.isSafeInteger(refund.amount) ||
      refund.amount <= 0 ||
      typeof refund.currency !== "string"
    ) {
      return json(request, { error: "Processed refund is missing required details" }, 422);
    }

    const { data: storedPayment, error: paymentError } = await admin
      .from("payments")
      .select("id,booking_id,provider_payment_id,status,amount,currency_code,provider_payload")
      .eq("provider", "razorpay")
      .eq("provider_payment_id", refund.payment_id)
      .in("status", ["captured", "partially_refunded", "refunded"])
      .maybeSingle<StoredPayment>();
    const capturedAmount = storedPayment ? Math.round(Number(storedPayment.amount) * 100) : Number.NaN;
    if (
      paymentError ||
      !storedPayment ||
      !Number.isSafeInteger(capturedAmount) ||
      refund.amount > capturedAmount ||
      refund.currency !== storedPayment.currency_code
    ) {
      return json(request, { error: "Refund does not match a captured payment" }, 422);
    }

    const refundId = refund.notes?.refund_id;
    let refundQuery = admin
      .from("refunds")
      .select("id,payment_id,status,amount,currency_code,idempotency_key")
      .eq("provider", "razorpay");
    refundQuery = isUuid(refundId)
      ? refundQuery.eq("id", refundId)
      : refundQuery.eq("provider_refund_id", refund.id);
    const { data: storedRefund, error: refundError } = await refundQuery.maybeSingle<StoredRefund>();
    const expectedRefundAmount = storedRefund ? Math.round(Number(storedRefund.amount) * 100) : Number.NaN;
    if (
      refundError ||
      !storedRefund ||
      storedRefund.payment_id !== storedPayment.id ||
      !Number.isSafeInteger(expectedRefundAmount) ||
      refund.amount !== expectedRefundAmount ||
      refund.currency !== storedRefund.currency_code
    ) {
      return json(request, { error: "Refund does not match a requested refund" }, 422);
    }

    const { error: completionError } = await admin.rpc("complete_refund", {
      p_refund_id: storedRefund.id,
      p_provider_refund_id: refund.id,
      p_idempotency_key: storedRefund.idempotency_key,
      p_provider_payload: refund,
    });
    if (completionError) return json(request, { error: "Unable to record processed refund" }, 503);
    if (await markProcessed()) return json(request, { error: "Unable to complete webhook event" }, 503);
    return json(request, { received: true, processed: true });
  }

  if (await markProcessed()) return json(request, { error: "Unable to complete webhook event" }, 503);
  return json(request, { received: true });
});
