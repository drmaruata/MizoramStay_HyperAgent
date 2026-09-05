import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const optionalInteger = (fallback: number, maximum: number) => z.preprocess(
  (value) => value === undefined || value === "" ? fallback : value,
  z.coerce.number().int().min(1).max(maximum),
);
const filterText = z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9_.:-]+$/).optional();
const auditQuerySchema = z.object({
  entity: filterText,
  action: filterText,
  actor: z.uuid("Invalid actor id").optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  page: optionalInteger(1, 10_000),
  pageSize: optionalInteger(50, 100),
}).strict().superRefine((value, context) => {
  if (!value.from || !value.to) return;
  const from = Date.parse(value.from);
  const to = Date.parse(value.to);
  if (from > to) {
    context.addIssue({ code: "custom", path: ["from"], message: "From date must not be after to date" });
  } else if (to - from > 90 * 24 * 60 * 60 * 1000) {
    context.addIssue({ code: "custom", path: ["to"], message: "Date range must be 90 days or fewer" });
  }
});

type AuditRow = {
  id: number | string;
  actor_id: string | null;
  entity_type: string;
  entity_id: string | null;
  action: string;
  metadata: unknown;
  created_at: string;
};

type ProfileRow = { id: string; display_name: string };

const sensitiveKey = /(?:password|passwd|secret|token|authorization|cookie|api[_-]?key|private[_-]?key|service[_-]?role|signature|provider[_-]?payload|payment[_-]?method|card|cvv)/i;

function sanitizeMetadata(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeMetadata(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !sensitiveKey.test(key))
        .slice(0, 100)
        .map(([key, item]) => [key, sanitizeMetadata(item, depth + 1)]),
    );
  }
  if (typeof value === "string") return value.slice(0, 1000);
  return value;
}

export async function GET(request: Request) {
  const parsed = auditQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid audit query", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

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

  const { entity, action, actor, from, to, page, pageSize } = parsed.data;
  const first = (page - 1) * pageSize;
  let query = supabase
    .from("audit_logs")
    .select("id,actor_id,entity_type,entity_id,action,metadata,created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(first, first + pageSize - 1);

  if (entity) query = query.eq("entity_type", entity);
  if (action) query = query.eq("action", action);
  if (actor) query = query.eq("actor_id", actor);
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", to);

  // This authenticated read is intentionally subject to audit_logs_admin_read RLS.
  const { data, error, count } = await query;
  if (error) {
    if (error.code === "42501") {
      return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
    }
    return NextResponse.json({ error: "Audit log is temporarily unavailable" }, { status: 503 });
  }

  const rows = (data ?? []) as AuditRow[];
  const actorIds = [...new Set(rows.flatMap((row) => row.actor_id ? [row.actor_id] : []))];
  const actorResult = actorIds.length
    ? await supabase.from("profiles").select("id,display_name").in("id", actorIds)
    : { data: [] as ProfileRow[], error: null };
  if (actorResult.error) {
    return NextResponse.json({ error: "Audit actor details are temporarily unavailable" }, { status: 503 });
  }
  const actorNames = new Map(((actorResult.data ?? []) as ProfileRow[]).map((profile) => [profile.id, profile.display_name]));

  return NextResponse.json({
    data: rows.map((row) => ({
      id: row.id,
      actorId: row.actor_id,
      actorName: row.actor_id ? actorNames.get(row.actor_id) ?? null : null,
      entityType: row.entity_type,
      entityId: row.entity_id,
      action: row.action,
      metadata: sanitizeMetadata(row.metadata),
      createdAt: row.created_at,
    })),
    pagination: {
      page,
      pageSize,
      total: count ?? 0,
      totalPages: Math.ceil((count ?? 0) / pageSize),
    },
    filters: { entity: entity ?? null, action: action ?? null, actor: actor ?? null, from: from ?? null, to: to ?? null },
  });
}
