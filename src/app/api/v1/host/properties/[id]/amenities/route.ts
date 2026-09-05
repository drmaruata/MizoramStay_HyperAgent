import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { propertyAmenitiesReplaceSchema, propertyIdSchema } from "@/lib/validation/property-update";

type RouteContext = { params: Promise<{ id: string }> };

async function replaceAmenities(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsedId = propertyIdSchema.safeParse(id);
  if (!parsedId.success) return NextResponse.json({ error: "Invalid property id" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const parsed = propertyAmenitiesReplaceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid amenity selection", details: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const propertyId = parsedId.data;
  const { data: property, error: propertyError } = await supabase
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .eq("host_id", user.id)
    .maybeSingle();
  if (propertyError) return NextResponse.json({ error: "Property lookup is temporarily unavailable" }, { status: 503 });
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });

  const requestedIds = parsed.data.amenityIds;
  if (requestedIds.length > 0) {
    const { data: validAmenities, error: amenityError } = await supabase
      .from("amenities")
      .select("id")
      .in("id", requestedIds);
    if (amenityError) return NextResponse.json({ error: "Unable to validate amenities" }, { status: 503 });

    const validIds = new Set((validAmenities ?? []).map((amenity) => amenity.id));
    const missingIds = requestedIds.filter((amenityId) => !validIds.has(amenityId));
    if (missingIds.length > 0) {
      return NextResponse.json({ error: "One or more amenities do not exist", missingAmenityIds: missingIds }, { status: 422 });
    }
  }

  const { data: previousRows, error: previousError } = await supabase
    .from("property_amenities")
    .select("amenity_id")
    .eq("property_id", propertyId);
  if (previousError) return NextResponse.json({ error: "Unable to read current amenities" }, { status: 503 });

  const previousIds = (previousRows ?? []).map((row) => row.amenity_id);
  if (previousIds.length === requestedIds.length && previousIds.every((amenityId) => requestedIds.includes(amenityId))) {
    return NextResponse.json({ amenityIds: requestedIds });
  }

  // No replace RPC is present in the current schema. Delete and insert are checked
  // separately, and a failed insert explicitly restores the previous selection.
  const { error: deleteError } = await supabase
    .from("property_amenities")
    .delete()
    .eq("property_id", propertyId);
  if (deleteError) return NextResponse.json({ error: "Unable to clear current amenities; no changes were applied" }, { status: 503 });

  if (requestedIds.length > 0) {
    const { error: insertError } = await supabase
      .from("property_amenities")
      .insert(requestedIds.map((amenityId) => ({ property_id: propertyId, amenity_id: amenityId })));

    if (insertError) {
      const restoration = previousIds.length === 0
        ? { error: null }
        : await supabase.from("property_amenities").insert(
          previousIds.map((amenityId) => ({ property_id: propertyId, amenity_id: amenityId })),
        );
      if (restoration.error) {
        return NextResponse.json({ error: "Unable to save amenities and unable to restore the previous selection" }, { status: 500 });
      }
      return NextResponse.json({ error: "Unable to save amenities; the previous selection was restored" }, { status: 503 });
    }
  }

  return NextResponse.json({ amenityIds: requestedIds });
}

export const PUT = replaceAmenities;
export const PATCH = replaceAmenities;
