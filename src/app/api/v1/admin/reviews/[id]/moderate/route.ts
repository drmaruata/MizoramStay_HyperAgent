import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const reviewIdSchema = z.uuid("Invalid review id");
const moderationSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  notes: z.string().trim().min(2, "Moderation notes are required.").max(2000),
}).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const parsedId = reviewIdSchema.safeParse(id);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Invalid review id" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = moderationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid moderation decision", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Keep the caller's JWT on the publishable-key server client so RLS and the
  // administrator check inside moderate_review remain effective.
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { data: adminProfile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .eq("role", "admin")
    .maybeSingle();

  if (profileError) {
    return NextResponse.json({ error: "Unable to verify administrator access" }, { status: 503 });
  }
  if (!adminProfile) {
    return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  }

  const { data, error } = await supabase.rpc("moderate_review", {
    p_review_id: parsedId.data,
    p_decision: parsed.data.decision,
    p_notes: parsed.data.notes,
  });

  if (error) {
    if (error.code === "P0002") {
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }
    if (error.code === "42501") {
      return NextResponse.json({ error: "Review moderation is not permitted" }, { status: 403 });
    }
    if (error.code === "P0001") {
      return NextResponse.json({ error: "This review has already been moderated" }, { status: 409 });
    }
    if (error.code === "22023" || error.code === "23514") {
      return NextResponse.json({ error: "Moderation decision is invalid" }, { status: 422 });
    }
    return NextResponse.json({ error: "Unable to moderate this review" }, { status: 503 });
  }

  return NextResponse.json({ review: data, message: "Moderation decision recorded" });
}
