import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

function parseDays(request: Request) {
  const value = new URL(request.url).searchParams.get("days");
  if (value === null) return 30;
  if (!/^\d+$/.test(value)) return null;

  const days = Number(value);
  return Number.isSafeInteger(days) && days >= 1 && days <= 365 ? days : null;
}

export async function GET(request: Request) {
  const days = parseDays(request);
  if (days === null) {
    return NextResponse.json(
      { error: "Analytics period must be an integer between 1 and 365 days" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const { data: adminProfile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .eq("role", "admin")
    .maybeSingle();

  if (profileError) {
    return NextResponse.json(
      { error: "Unable to verify administrator access" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
  if (!adminProfile) {
    return NextResponse.json(
      { error: "Administrator access required" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const { data, error } = await supabase.rpc("get_marketplace_analytics", { p_days: days });
  if (error) {
    if (error.code === "42501") {
      return NextResponse.json(
        { error: "Administrator access required" },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }
    if (error.code === "22023") {
      return NextResponse.json(
        { error: "Analytics period is invalid" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(
      { error: "Marketplace analytics are temporarily unavailable" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json({ data }, { status: 200, headers: NO_STORE_HEADERS });
}
