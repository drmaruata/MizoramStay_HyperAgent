import { NextResponse } from "next/server";
import {
  verificationDecisionSchema,
  verificationRequestIdSchema,
} from "@/lib/validation/verification";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const parsedId = verificationRequestIdSchema.safeParse(id);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Invalid verification request id" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = verificationDecisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid verification action", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
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

  const result = parsed.data.action === "claim"
    ? await supabase.rpc("claim_verification_request", {
        p_request_id: parsedId.data,
        p_review_level: parsed.data.reviewLevel ?? null,
      })
    : await supabase.rpc("decide_verification_request", {
        p_request_id: parsedId.data,
        p_decision: parsed.data.decision,
        p_review_level: parsed.data.reviewLevel,
        p_notes: parsed.data.notes ?? null,
        p_change_requests: parsed.data.changeRequests,
      });

  if (result.error) {
    if (result.error.code === "P0002") {
      return NextResponse.json({ error: "Verification request not found" }, { status: 404 });
    }
    if (result.error.code === "42501") {
      return NextResponse.json({ error: "Verification action is not permitted" }, { status: 403 });
    }
    if (result.error.code === "P0001") {
      return NextResponse.json({ error: "Verification request state has changed" }, { status: 409 });
    }
    if (result.error.code === "22023") {
      return NextResponse.json({ error: "Verification action is invalid" }, { status: 422 });
    }
    return NextResponse.json({ error: "Unable to update verification request" }, { status: 503 });
  }

  return NextResponse.json({ verification: result.data }, { status: 200 });
}
