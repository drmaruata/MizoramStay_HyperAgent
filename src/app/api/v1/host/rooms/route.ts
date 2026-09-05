import { NextResponse } from "next/server";
import { z } from "zod";
import { roomCreateSchema } from "@/lib/validation/room";
import { createClient } from "@/lib/supabase/server";

const roomsQuerySchema = z.object({
  propertyId: z.uuid().optional(),
});

export async function GET(request: Request) {
  const params = roomsQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!params.success) {
    return NextResponse.json({ error: "Invalid rooms query" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let query = supabase
    .from("rooms")
    .select("id,property_id,name,description,capacity_adults,capacity_children,beds_description,base_nightly_rate,currency_code,is_active,created_at,updated_at")
    .order("created_at", { ascending: false });

  if (params.data.propertyId) {
    query = query.eq("property_id", params.data.propertyId);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: "Rooms are temporarily unavailable" }, { status: 503 });
  }

  return NextResponse.json({ data });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = roomCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid room request", details: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const room = parsed.data;
  const { data, error } = await supabase
    .from("rooms")
    .insert({
      property_id: room.propertyId,
      name: room.name,
      description: room.description ?? null,
      capacity_adults: room.capacityAdults,
      capacity_children: room.capacityChildren ?? 0,
      beds_description: room.bedsDescription ?? null,
      base_nightly_rate: room.baseNightlyRate,
      currency_code: room.currencyCode ?? "INR",
      is_active: room.isActive ?? true,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "A room with this name already exists for this property" }, { status: 409 });
    }
    return NextResponse.json({ error: "Unable to create room" }, { status: 503 });
  }

  return NextResponse.json({ room: data }, { status: 201 });
}
