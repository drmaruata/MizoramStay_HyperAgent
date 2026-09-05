import { NextResponse } from "next/server";
import { bookingHoldSchema } from "@/lib/validation/booking";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const parsed = bookingHoldSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid booking request", details: parsed.error.flatten() }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { propertyId, roomId, contactName, contactEmail, contactPhone, checkIn, checkOut, guests, idempotencyKey } = parsed.data;
  const { data, error } = await supabase.rpc("create_booking_hold", {
    p_property_id: propertyId,
    p_room_id: roomId,
    p_check_in: checkIn.toISOString().slice(0, 10),
    p_check_out: checkOut.toISOString().slice(0, 10),
    p_guest_count: guests,
    p_contact_name: contactName,
    p_contact_email: contactEmail,
    p_contact_phone: contactPhone ?? null,
    p_idempotency_key: idempotencyKey,
  });

  if (error) return NextResponse.json({ error: "Unable to reserve this stay" }, { status: 409 });
  return NextResponse.json({ hold: data }, { status: 201 });
}
