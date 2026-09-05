import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const propertyIdSchema = z.uuid();

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const parsedId = propertyIdSchema.safeParse(id);

  if (!parsedId.success) {
    return NextResponse.json({ error: "Invalid property id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { data, error } = await supabase.rpc("submit_property_for_review", { p_property_id: parsedId.data });
  if (!error) return NextResponse.json({ property: data }, { status: 200 });
  if (error.code === "P0001") return NextResponse.json({ error: "Property is not ready for submission" }, { status: 422 });
  if (error.code === "P0002") return NextResponse.json({ error: "Draft property not found" }, { status: 404 });
  return NextResponse.json({ error: "Unable to submit property" }, { status: 503 });
}
