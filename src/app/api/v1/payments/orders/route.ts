import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  paymentOrderResponseSchema,
  paymentOrderSchema,
} from "@/lib/validation/phase3-booking";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsedBody = paymentOrderSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Invalid payment order request", details: parsedBody.error.flatten() },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  // Read through RLS first; the browser never receives credentials that can bypass it.
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id,status,hold_expires_at")
    .eq("id", parsedBody.data.bookingId)
    .eq("guest_id", user.id)
    .maybeSingle<{ id: string; status: string; hold_expires_at: string | null }>();

  if (bookingError) {
    return NextResponse.json({ error: "Unable to verify this booking" }, { status: 503 });
  }
  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }
  if (
    booking.status !== "hold"
    || !booking.hold_expires_at
    || new Date(booking.hold_expires_at).getTime() <= Date.now()
  ) {
    return NextResponse.json({ error: "This booking hold is no longer payable" }, { status: 409 });
  }

  // The Edge Function owns Razorpay secrets and payment-row creation. The authenticated
  // SSR client forwards the current user's access token; no privileged key enters the browser.
  const { data, error } = await supabase.functions.invoke("create-razorpay-order", {
    body: { bookingId: booking.id },
  });

  if (error) {
    return NextResponse.json({ error: "Unable to start payment" }, { status: 502 });
  }

  const parsedOrder = paymentOrderResponseSchema.safeParse(data);
  if (!parsedOrder.success) {
    return NextResponse.json({ error: "Payment service returned an invalid response" }, { status: 502 });
  }

  return NextResponse.json(
    { order: parsedOrder.data },
    { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}
