import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { bookingIdSchema } from "@/lib/validation/phase3-booking";

type RouteContext = { params: Promise<{ id: string }> };

const bookingSelection = `
  id,
  status,
  check_in,
  check_out,
  guest_count,
  contact_name,
  contact_email,
  contact_phone,
  currency_code,
  subtotal,
  taxes,
  total_amount,
  hold_expires_at,
  cancelled_at,
  cancellation_reason,
  created_at,
  properties:property_id (
    id,
    name,
    slug,
    locality,
    check_in_time,
    check_out_time,
    destinations:destination_id (name, state)
  ),
  booking_items (
    id,
    quantity,
    nightly_rate,
    nights,
    line_total,
    rooms:room_id (id, name, beds_description)
  ),
  payments (
    id,
    provider,
    status,
    amount,
    currency_code,
    paid_at,
    created_at
  ),
  cancellation_requests (
    id,
    status,
    policy_code,
    reason,
    refundable_amount,
    currency_code,
    completed_at,
    created_at
  ),
  refunds (
    id,
    provider,
    status,
    amount,
    currency_code,
    requested_at,
    completed_at,
    created_at
  )
`;

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsedId = bookingIdSchema.safeParse(id);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Invalid booking id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  // This is the cookie-authenticated, publishable-key client. The guest filter and
  // database RLS both prevent this customer endpoint from exposing another booking.
  const { data: booking, error } = await supabase
    .from("bookings")
    .select(bookingSelection)
    .eq("id", parsedId.data)
    .eq("guest_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Booking details are temporarily unavailable" }, { status: 503 });
  }
  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  return NextResponse.json(
    { booking },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}
