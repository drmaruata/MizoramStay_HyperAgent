import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { reviewIdSchema, reviewResponseSchema } from "@/lib/validation/review";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsedId = reviewIdSchema.safeParse(id);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Invalid review id" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsedBody = reviewResponseSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Invalid host response", details: parsedBody.error.flatten() },
      { status: 400 },
    );
  }

  // The user-scoped client carries the host JWT into the owner-checking RPC. No service role
  // is used in this user-facing API.
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { data, error } = await supabase.rpc("respond_to_review", {
    p_review_id: parsedId.data,
    p_response: parsedBody.data.response,
  });

  if (error) {
    if (error.code === "P0002") {
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }
    if (error.code === "42501") {
      return NextResponse.json({ error: "Only the property owner may respond to this review" }, { status: 403 });
    }
    if (error.code === "23505") {
      return NextResponse.json({ error: "This review already has a host response" }, { status: 409 });
    }
    if (error.code === "P0001") {
      return NextResponse.json({ error: "Only approved reviews can receive a response" }, { status: 409 });
    }
    if (error.code === "22023") {
      return NextResponse.json({ error: "Host response is invalid" }, { status: 422 });
    }
    return NextResponse.json({ error: "Unable to respond to this review" }, { status: 503 });
  }

  return NextResponse.json({ review: data }, { status: 200 });
}
