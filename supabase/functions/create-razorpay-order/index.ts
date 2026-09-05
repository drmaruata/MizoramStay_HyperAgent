// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// Supabase Edge Functions run under Deno and resolve the URL imports below at deployment time.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, isAllowedCorsOrigin } from "../_shared/cors.ts";

type OrderRequest = { bookingId?: unknown };
type Booking = {
  id: string;
  guest_id: string;
  status: string;
  hold_expires_at: string | null;
  total_amount: number | string;
  currency_code: string;
};

function json(request: Request, body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders(request) });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return isAllowedCorsOrigin(request)
      ? new Response(null, { status: 204, headers: corsHeaders(request) })
      : new Response(null, { status: 403 });
  }
  if (request.method !== "POST") return json(request, { error: "Method not allowed" }, 405);
  if (request.headers.has("origin") && !isAllowedCorsOrigin(request)) {
    return new Response(null, { status: 403 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const razorpayKeyId = Deno.env.get("RAZORPAY_KEY_ID");
  const razorpayKeySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
  if (!supabaseUrl || !publishableKey || !serviceRoleKey || !razorpayKeyId || !razorpayKeySecret) {
    return json(request, { error: "Payment service is not configured" }, 503);
  }

  const authorization = request.headers.get("authorization");
  if (!authorization) return json(request, { error: "Authentication required" }, 401);

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json(request, { error: "Authentication required" }, 401);

  const body = await request.json().catch(() => null) as OrderRequest | null;
  if (!body || typeof body.bookingId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.bookingId)) {
    return json(request, { error: "A valid booking ID is required" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: booking, error: bookingError } = await admin
    .from("bookings")
    .select("id,guest_id,status,hold_expires_at,total_amount,currency_code")
    .eq("id", body.bookingId)
    .maybeSingle<Booking>();
  if (bookingError || !booking || booking.guest_id !== user.id) return json(request, { error: "Booking not found" }, 404);
  if (booking.status !== "hold" || !booking.hold_expires_at || new Date(booking.hold_expires_at).getTime() <= Date.now()) {
    return json(request, { error: "This booking hold is no longer payable" }, 409);
  }

  const { data: existingPayment } = await admin
    .from("payments")
    .select("provider_payment_id,status")
    .eq("booking_id", booking.id)
    .eq("provider", "razorpay")
    .eq("status", "pending")
    .limit(1)
    .maybeSingle<{ provider_payment_id: string; status: string }>();
  if (existingPayment) {
    return json(request, { orderId: existingPayment.provider_payment_id, keyId: razorpayKeyId, amount: Math.round(Number(booking.total_amount) * 100), currency: booking.currency_code });
  }

  const amount = Math.round(Number(booking.total_amount) * 100);
  if (!Number.isSafeInteger(amount) || amount < 100) return json(request, { error: "Invalid booking amount" }, 409);

  const razorpayResponse = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${razorpayKeyId}:${razorpayKeySecret}`)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ amount, currency: booking.currency_code, receipt: booking.id, notes: { booking_id: booking.id } }),
  });
  if (!razorpayResponse.ok) return json(request, { error: "Unable to create payment order" }, 502);

  const order = await razorpayResponse.json() as { id?: unknown };
  if (typeof order.id !== "string" || !order.id) return json(request, { error: "Invalid payment provider response" }, 502);

  const { error: paymentError } = await admin.from("payments").insert({
    booking_id: booking.id,
    provider: "razorpay",
    provider_payment_id: order.id,
    amount: booking.total_amount,
    currency_code: booking.currency_code,
    status: "pending",
    provider_payload: { order_id: order.id },
  });
  if (paymentError) return json(request, { error: "Unable to record payment order" }, 503);

  return json(request, { orderId: order.id, keyId: razorpayKeyId, amount, currency: booking.currency_code }, 201);
});
