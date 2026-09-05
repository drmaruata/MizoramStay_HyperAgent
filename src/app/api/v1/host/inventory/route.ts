import { NextResponse } from "next/server";
import { z } from "zod";
import { inventoryUpsertSchema } from "@/lib/validation/room";
import { createClient } from "@/lib/supabase/server";

const inventoryQuerySchema = z.object({
  roomId: z.uuid(),
  startDate: z.iso.date().optional(),
  endDate: z.iso.date().optional(),
}).superRefine((value, context) => {
  if (value.startDate && value.endDate && value.endDate < value.startDate) {
    context.addIssue({ code: "custom", message: "End date must be on or after start date.", path: ["endDate"] });
  }
});

function datesInRange(startDate: string, endDate: string) {
  const dates: string[] = [];
  const current = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);

  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

export async function GET(request: Request) {
  const params = inventoryQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!params.success) {
    return NextResponse.json({ error: "Invalid inventory query" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let query = supabase
    .from("nightly_inventory")
    .select("room_id,stay_date,available_units,nightly_rate,currency_code,minimum_nights,closed_to_arrival,closed_to_departure,updated_at")
    .eq("room_id", params.data.roomId)
    .order("stay_date", { ascending: true });

  if (params.data.startDate) {
    query = query.gte("stay_date", params.data.startDate);
  }
  if (params.data.endDate) {
    query = query.lte("stay_date", params.data.endDate);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: "Inventory is temporarily unavailable" }, { status: 503 });
  }

  return NextResponse.json({ data });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = inventoryUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid inventory request", details: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const inventory = parsed.data;
  const rows = datesInRange(inventory.startDate, inventory.endDate).map((stayDate) => ({
    room_id: inventory.roomId,
    stay_date: stayDate,
    available_units: inventory.availableUnits,
    nightly_rate: inventory.nightlyRate,
    currency_code: inventory.currencyCode ?? "INR",
    minimum_nights: inventory.minimumNights ?? 1,
    closed_to_arrival: inventory.closedToArrival ?? false,
    closed_to_departure: inventory.closedToDeparture ?? false,
  }));

  const { data, error } = await supabase
    .from("nightly_inventory")
    .upsert(rows, { onConflict: "room_id,stay_date" })
    .select();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Inventory conflicts with an existing record" }, { status: 409 });
    }
    return NextResponse.json({ error: "Unable to update inventory" }, { status: 503 });
  }

  return NextResponse.json({ inventory: data }, { status: 201 });
}
