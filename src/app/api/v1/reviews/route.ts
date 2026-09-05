import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { reviewSubmissionSchema } from "@/lib/validation/review";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = reviewSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid review", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // The authenticated publishable-key client preserves the caller's JWT. The RPC is the
  // atomic authorization and write boundary; this route never uses service-role access.
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { data, error } = await supabase.rpc("submit_review", {
    p_booking_id: parsed.data.bookingId,
    p_rating: parsed.data.rating,
    p_title: parsed.data.title ?? null,
    p_body: parsed.data.body,
  });

  if (error) {
    if (error.code === "P0002") {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }
    if (error.code === "42501") {
      return NextResponse.json({ error: "Only the booking guest may review this stay" }, { status: 403 });
    }
    if (error.code === "23505") {
      return NextResponse.json({ error: "This booking already has a review" }, { status: 409 });
    }
    if (error.code === "P0001") {
      return NextResponse.json({ error: "Only a completed stay can be reviewed" }, { status: 409 });
    }
    if (error.code === "22023") {
      return NextResponse.json({ error: "Review details are invalid" }, { status: 422 });
    }
    return NextResponse.json({ error: "Unable to submit this review" }, { status: 503 });
  }

  return NextResponse.json(
    { review: data, message: "Review submitted for moderation" },
    { status: 201 },
  );
}
