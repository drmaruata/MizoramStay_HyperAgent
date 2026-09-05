import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createSupportCaseSchema,
  supportCaseListQuerySchema,
} from "@/lib/validation/support";

const noStoreHeaders = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: Request) {
  const parsed = supportCaseListQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid support case query", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { status, priority, limit, offset } = parsed.data;
  const { data, error } = await supabase.rpc("list_support_cases", {
    p_status: status ?? null,
    p_priority: priority ?? null,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    if (error.code === "42501") {
      return NextResponse.json({ error: "Support cases are not accessible" }, { status: 403 });
    }
    return NextResponse.json({ error: "Support cases are temporarily unavailable" }, { status: 503 });
  }

  const total = data && data.length > 0 ? Number(data[0].total_count) : 0;
  return NextResponse.json(
    { data: data ?? [], pagination: { limit, offset, total } },
    { headers: noStoreHeaders },
  );
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = createSupportCaseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid support case", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { subject, message, category, priority, bookingId } = parsed.data;
  const { data, error } = await supabase.rpc("create_support_case", {
    p_subject: subject,
    p_message: message,
    p_category: category,
    p_priority: priority,
    p_booking_id: bookingId ?? null,
  });

  if (error) {
    if (error.code === "P0002") {
      return NextResponse.json({ error: "Linked booking was not found" }, { status: 404 });
    }
    if (error.code === "42501") {
      return NextResponse.json({ error: "Support case cannot be created for this account" }, { status: 403 });
    }
    if (error.code === "22023") {
      return NextResponse.json({ error: "Support case details are invalid" }, { status: 422 });
    }
    return NextResponse.json({ error: "Unable to create support case" }, { status: 503 });
  }

  return NextResponse.json(
    { supportCase: data },
    { status: 201, headers: noStoreHeaders },
  );
}
