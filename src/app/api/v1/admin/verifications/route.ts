import { NextResponse } from "next/server";
import { verificationListQuerySchema } from "@/lib/validation/verification";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const parsed = verificationListQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid verification queue query", details: parsed.error.flatten() },
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

  const { status, reviewLevel, limit, offset } = parsed.data;
  const { data, error } = await supabase.rpc("list_verification_requests", {
    p_status: status ?? null,
    p_review_level: reviewLevel ?? null,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    if (error.code === "42501") {
      return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
    }
    return NextResponse.json({ error: "Verification queue is temporarily unavailable" }, { status: 503 });
  }

  const total = data && data.length > 0 ? Number(data[0].total_count) : 0;
  return NextResponse.json({
    data,
    pagination: { limit, offset, total },
  });
}
