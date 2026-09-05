import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  supportCaseActionSchema,
  supportCaseIdSchema,
} from "@/lib/validation/support";

const noStoreHeaders = { "Cache-Control": "private, no-store, max-age=0" };
type RouteContext = { params: Promise<{ id: string }> };

const caseSelection = `
  id,
  customer_id,
  host_id,
  booking_id,
  assigned_to,
  category,
  priority,
  status,
  subject,
  resolution_summary,
  assigned_at,
  resolved_at,
  closed_at,
  created_at,
  updated_at,
  bookings:booking_id (
    id,
    status,
    check_in,
    check_out,
    properties:property_id (id, name)
  )
`;

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsedId = supportCaseIdSchema.safeParse(id);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Invalid support case id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { data: supportCase, error: caseError } = await supabase
    .from("support_cases")
    .select(caseSelection)
    .eq("id", parsedId.data)
    .maybeSingle();

  if (caseError) {
    return NextResponse.json({ error: "Support case is temporarily unavailable" }, { status: 503 });
  }
  if (!supportCase) {
    return NextResponse.json({ error: "Support case not found" }, { status: 404 });
  }

  const { data: messages, error: messagesError } = await supabase
    .from("support_case_messages")
    .select("id,support_case_id,author_id,body,is_internal,created_at")
    .eq("support_case_id", parsedId.data)
    .order("created_at", { ascending: true });

  if (messagesError) {
    return NextResponse.json({ error: "Support case messages are temporarily unavailable" }, { status: 503 });
  }

  return NextResponse.json(
    { supportCase, messages: messages ?? [] },
    { headers: noStoreHeaders },
  );
}

async function handleAction(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsedId = supportCaseIdSchema.safeParse(id);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Invalid support case id" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = supportCaseActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid support case action", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const requiresAdmin = parsed.data.action !== "message" || parsed.data.internal;
  if (requiresAdmin) {
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
  }

  const result = parsed.data.action === "message"
    ? await supabase.rpc("add_support_case_message", {
        p_case_id: parsedId.data,
        p_message: parsed.data.message,
        p_internal: parsed.data.internal,
      })
    : parsed.data.action === "assign"
      ? await supabase.rpc("assign_support_case", {
          p_case_id: parsedId.data,
          p_assignee_id: parsed.data.assigneeId ?? null,
          p_priority: parsed.data.priority ?? null,
        })
      : await supabase.rpc("resolve_support_case", {
          p_case_id: parsedId.data,
          p_resolution: parsed.data.resolution,
        });

  if (result.error) {
    if (result.error.code === "P0002") {
      return NextResponse.json({ error: "Support case not found" }, { status: 404 });
    }
    if (result.error.code === "42501") {
      return NextResponse.json({ error: "Support case action is not permitted" }, { status: 403 });
    }
    if (result.error.code === "P0001") {
      return NextResponse.json({ error: "Support case state has changed" }, { status: 409 });
    }
    if (result.error.code === "22023") {
      return NextResponse.json({ error: "Support case action is invalid" }, { status: 422 });
    }
    return NextResponse.json({ error: "Unable to update support case" }, { status: 503 });
  }

  const responseKey = parsed.data.action === "message" ? "message" : "supportCase";
  return NextResponse.json({ [responseKey]: result.data }, { headers: noStoreHeaders });
}

export async function PATCH(request: Request, context: RouteContext) {
  return handleAction(request, context);
}

// POST is retained for clients that model a reply as a nested resource operation.
export async function POST(request: Request, context: RouteContext) {
  return handleAction(request, context);
}
