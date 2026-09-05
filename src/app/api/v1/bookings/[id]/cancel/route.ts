import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { bookingIdSchema, cancelBookingSchema } from "@/lib/validation/phase3-booking";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsedId = bookingIdSchema.safeParse(id);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Invalid booking id" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsedBody = cancelBookingSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Invalid cancellation request", details: parsedBody.error.flatten() },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  // Check ownership with the RLS-bound user client before entering the atomic write path.
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id,status")
    .eq("id", parsedId.data)
    .eq("guest_id", user.id)
    .maybeSingle<{ id: string; status: string }>();

  if (bookingError) {
    return NextResponse.json({ error: "Unable to verify this booking" }, { status: 503 });
  }
  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }
  if (booking.status !== "hold" && booking.status !== "confirmed") {
    return NextResponse.json({ error: "This booking can no longer be cancelled" }, { status: 409 });
  }

  // The RPC owns status transition, inventory release, audit logging, and any refund state.
  // Keeping them in one database transaction prevents a partially cancelled reservation.
  const { data: cancelledBooking, error: cancellationError } = await supabase.rpc("cancel_booking", {
    p_booking_id: parsedId.data,
    p_reason: parsedBody.data.reason,
  });

  if (cancellationError) {
    const conflictCodes = new Set(["P0001", "P0002", "22023", "23514"]);
    const status = conflictCodes.has(cancellationError.code ?? "") ? 409 : 503;
    return NextResponse.json(
      { error: status === 409 ? "This booking can no longer be cancelled" : "Unable to cancel this booking" },
      { status },
    );
  }

  return NextResponse.json({ cancellation: cancelledBooking });
}
