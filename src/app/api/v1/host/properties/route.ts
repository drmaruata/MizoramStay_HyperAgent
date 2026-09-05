import { NextResponse } from "next/server";
import { propertyCreateSchema } from "@/lib/validation/property";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("properties")
    .select("id,destination_id,slug,name,summary,description,address_line1,address_line2,locality,postal_code,latitude,longitude,check_in_time,check_out_time,status,max_guests,created_at,updated_at")
    .eq("host_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Properties are temporarily unavailable" }, { status: 503 });
  }

  return NextResponse.json({ data });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = propertyCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid property request", details: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const property = parsed.data;
  const { data, error } = await supabase
    .from("properties")
    .insert({
      host_id: user.id,
      destination_id: property.destinationId,
      slug: property.slug,
      name: property.name,
      summary: property.summary ?? null,
      description: property.description ?? null,
      address_line1: property.addressLine1,
      address_line2: property.addressLine2 ?? null,
      locality: property.locality ?? null,
      postal_code: property.postalCode ?? null,
      latitude: property.latitude ?? null,
      longitude: property.longitude ?? null,
      check_in_time: property.checkInTime ?? "14:00",
      check_out_time: property.checkOutTime ?? "11:00",
      max_guests: property.maxGuests ?? 1,
      status: "draft",
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "A property with this slug already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "Unable to create property" }, { status: 503 });
  }

  return NextResponse.json({ property: data }, { status: 201 });
}
