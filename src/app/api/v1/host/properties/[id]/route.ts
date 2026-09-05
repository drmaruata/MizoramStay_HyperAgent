import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { propertyIdSchema, propertyUpdateSchema } from "@/lib/validation/property-update";

type RouteContext = { params: Promise<{ id: string }> };

const propertySelection = "id,destination_id,slug,name,summary,description,address_line1,address_line2,locality,postal_code,latitude,longitude,check_in_time,check_out_time,status,max_guests,created_at,updated_at";

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsedId = propertyIdSchema.safeParse(id);
  if (!parsedId.success) return NextResponse.json({ error: "Invalid property id" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const parsed = propertyUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid property update", details: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { data: current, error: currentError } = await supabase
    .from("properties")
    .select(propertySelection)
    .eq("id", parsedId.data)
    .eq("host_id", user.id)
    .maybeSingle();
  if (currentError) return NextResponse.json({ error: "Property lookup is temporarily unavailable" }, { status: 503 });
  if (!current) return NextResponse.json({ error: "Property not found" }, { status: 404 });

  const input = parsed.data;
  const checkIn = input.checkInTime ?? String(current.check_in_time).slice(0, 5);
  const checkOut = input.checkOutTime ?? String(current.check_out_time).slice(0, 5);
  if (checkIn === checkOut) {
    return NextResponse.json({ error: "Check-in and check-out times must differ" }, { status: 400 });
  }

  const update: Record<string, string | number | null> = {};
  if (input.destinationId !== undefined) update.destination_id = input.destinationId;
  if (input.slug !== undefined) update.slug = input.slug;
  if (input.name !== undefined) update.name = input.name;
  if (input.summary !== undefined) update.summary = input.summary;
  if (input.description !== undefined) update.description = input.description;
  if (input.addressLine1 !== undefined) update.address_line1 = input.addressLine1;
  if (input.addressLine2 !== undefined) update.address_line2 = input.addressLine2;
  if (input.locality !== undefined) update.locality = input.locality;
  if (input.postalCode !== undefined) update.postal_code = input.postalCode;
  if (input.latitude !== undefined) update.latitude = input.latitude;
  if (input.longitude !== undefined) update.longitude = input.longitude;
  if (input.checkInTime !== undefined) update.check_in_time = input.checkInTime;
  if (input.checkOutTime !== undefined) update.check_out_time = input.checkOutTime;
  if (input.maxGuests !== undefined) update.max_guests = input.maxGuests;

  // host_id, status and moderation timestamps are deliberately not present in this allowlist.
  const { data: property, error: updateError } = await supabase
    .from("properties")
    .update(update)
    .eq("id", parsedId.data)
    .eq("host_id", user.id)
    .select(propertySelection)
    .maybeSingle();

  if (updateError?.code === "23505") {
    return NextResponse.json({ error: "A property with this slug already exists" }, { status: 409 });
  }
  if (updateError?.code === "23503") {
    return NextResponse.json({ error: "Destination not found" }, { status: 422 });
  }
  if (updateError) return NextResponse.json({ error: "Unable to update property" }, { status: 503 });
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });

  return NextResponse.json({ property });
}
