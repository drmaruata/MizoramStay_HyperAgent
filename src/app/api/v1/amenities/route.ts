import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("amenities")
    .select("id,slug,name,category,icon_name")
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: "Amenities are temporarily unavailable" }, { status: 503 });

  return NextResponse.json({ data: data ?? [] });
}
