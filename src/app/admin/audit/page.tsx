import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type SearchParams = {
  entity?: string | string[];
  action?: string | string[];
  actor?: string | string[];
  from?: string | string[];
  to?: string | string[];
  page?: string | string[];
};
type Props = { searchParams: Promise<SearchParams> };
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

type ParsedFilters = {
  entity?: string;
  action?: string;
  actor?: string;
  from?: string;
  to?: string;
  page: number;
  errors: string[];
};

const PAGE_SIZE = 50;
const filterPattern = /^[a-zA-Z0-9_.:-]+$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const sensitiveKey = /(?:password|passwd|secret|token|authorization|cookie|api[_-]?key|private[_-]?key|service[_-]?role|signature|provider[_-]?payload|payment[_-]?method|card|cvv)/i;

function one(value: string | string[] | undefined) {
  return typeof value === "string" ? value.trim() : undefined;
}

function parseFilters(params: SearchParams): ParsedFilters {
  const errors: string[] = [];
  const entityValue = one(params.entity);
  const actionValue = one(params.action);
  const actorValue = one(params.actor);
  const fromValue = one(params.from);
  const toValue = one(params.to);
  const pageValue = one(params.page);

  const validText = (value: string | undefined, label: string) => {
    if (!value) return undefined;
    if (value.length > 80 || !filterPattern.test(value)) {
      errors.push(`${label} must use 1–80 letters, numbers, dots, colons, underscores, or hyphens.`);
      return undefined;
    }
    return value;
  };

  const entity = validText(entityValue, "Entity");
  const action = validText(actionValue, "Action");
  const actor = actorValue && uuidPattern.test(actorValue) ? actorValue : undefined;
  if (actorValue && !actor) errors.push("Actor must be a valid UUID.");

  const from = fromValue && datePattern.test(fromValue) && !Number.isNaN(Date.parse(`${fromValue}T00:00:00.000Z`)) ? fromValue : undefined;
  const to = toValue && datePattern.test(toValue) && !Number.isNaN(Date.parse(`${toValue}T00:00:00.000Z`)) ? toValue : undefined;
  if (fromValue && !from) errors.push("From must be a valid date.");
  if (toValue && !to) errors.push("To must be a valid date.");
  if (from && to) {
    const range = Date.parse(`${to}T23:59:59.999Z`) - Date.parse(`${from}T00:00:00.000Z`);
    if (range < 0) errors.push("From date must not be after to date.");
    if (range > 90 * 24 * 60 * 60 * 1000) errors.push("Date range must be 90 days or fewer.");
  }

  const parsedPage = pageValue ? Number(pageValue) : 1;
  const page = Number.isInteger(parsedPage) && parsedPage >= 1 && parsedPage <= 10_000 ? parsedPage : 1;
  if (pageValue && page === 1 && pageValue !== "1") errors.push("Page must be an integer between 1 and 10000.");

  return { entity, action, actor, from, to, page, errors };
}

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

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

function label(value: string) {
  return value.replaceAll("_", " ");
}

function pageHref(filters: ParsedFilters, page: number) {
  const params = new URLSearchParams();
  if (filters.entity) params.set("entity", filters.entity);
  if (filters.action) params.set("action", filters.action);
  if (filters.actor) params.set("actor", filters.actor);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  params.set("page", String(page));
  return `/admin/audit?${params.toString()}`;
}

export default async function AuditPage({ searchParams }: Props) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect("/login");

  const { data: adminProfile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (profileError) throw new Error("Unable to verify administrator access.");
  if (!adminProfile) redirect("/");

  const rawParams = await searchParams;
  const filters = parseFilters(rawParams);
  const first = (filters.page - 1) * PAGE_SIZE;
  let query = supabase
    .from("audit_logs")
    .select("id,actor_id,entity_type,entity_id,action,metadata,created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(first, first + PAGE_SIZE - 1);

  if (filters.errors.length === 0) {
    if (filters.entity) query = query.eq("entity_type", filters.entity);
    if (filters.action) query = query.eq("action", filters.action);
    if (filters.actor) query = query.eq("actor_id", filters.actor);
    if (filters.from) query = query.gte("created_at", `${filters.from}T00:00:00.000Z`);
    if (filters.to) query = query.lte("created_at", `${filters.to}T23:59:59.999Z`);
  } else {
    query = query.eq("id", -1);
  }

  // The caller-scoped client keeps this read behind audit_logs_admin_read RLS.
  const auditResult = await query;
  const rows = (auditResult.data ?? []) as AuditRow[];
  const actorIds = [...new Set(rows.flatMap((row) => row.actor_id ? [row.actor_id] : []))];
  const actorResult = actorIds.length
    ? await supabase.from("profiles").select("id,display_name").in("id", actorIds)
    : { data: [] as ProfileRow[], error: null };
  const actorNames = new Map(((actorResult.data ?? []) as ProfileRow[]).map((profile) => [profile.id, profile.display_name]));
  const total = auditResult.count ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const hasDataError = Boolean(auditResult.error || actorResult.error);

  return <main className="min-h-screen bg-[var(--paper)]">
    <header className="border-b border-[var(--line)] bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
        <Link className="brand-mark font-bold" href="/">mizoram<span>stay</span></Link>
        <span className="rounded-full bg-[var(--deep)] px-3 py-1 text-sm font-semibold text-white">Administrator audit</span>
      </div>
    </header>

    <section className="mx-auto max-w-7xl px-5 py-10">
      <p className="eyebrow">Accountability</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="text-4xl font-semibold">Audit log</h1><p className="mt-2 text-[var(--muted)]">Read-only operational history. Sensitive metadata keys are removed before rendering.</p></div>
        <Link className="text-sm font-semibold text-[var(--forest)] underline underline-offset-4" href="/admin/reviews">Review moderation</Link>
      </div>

      <form className="mt-8 grid gap-4 rounded-2xl border border-[var(--line)] bg-white p-5 md:grid-cols-2 xl:grid-cols-6" method="get">
        <label className="text-sm font-semibold">Entity
          <input className="mt-2 w-full rounded-xl border border-[var(--line)] px-3 py-2 font-normal" name="entity" maxLength={80} pattern="[a-zA-Z0-9_.:-]+" defaultValue={one(rawParams.entity) ?? ""} placeholder="review" />
        </label>
        <label className="text-sm font-semibold">Action
          <input className="mt-2 w-full rounded-xl border border-[var(--line)] px-3 py-2 font-normal" name="action" maxLength={80} pattern="[a-zA-Z0-9_.:-]+" defaultValue={one(rawParams.action) ?? ""} placeholder="moderated" />
        </label>
        <label className="text-sm font-semibold xl:col-span-2">Actor UUID
          <input className="mt-2 w-full rounded-xl border border-[var(--line)] px-3 py-2 font-mono text-xs font-normal" name="actor" defaultValue={one(rawParams.actor) ?? ""} placeholder="00000000-0000-0000-0000-000000000000" />
        </label>
        <label className="text-sm font-semibold">From
          <input className="mt-2 w-full rounded-xl border border-[var(--line)] px-3 py-2 font-normal" name="from" type="date" defaultValue={one(rawParams.from) ?? ""} />
        </label>
        <label className="text-sm font-semibold">To
          <input className="mt-2 w-full rounded-xl border border-[var(--line)] px-3 py-2 font-normal" name="to" type="date" defaultValue={one(rawParams.to) ?? ""} />
        </label>
        <div className="flex items-end gap-3 xl:col-span-6">
          <button className="rounded-full bg-[var(--forest)] px-5 py-2.5 text-sm font-semibold text-white" type="submit">Apply filters</button>
          <Link className="rounded-full border border-[var(--line)] px-5 py-2.5 text-sm font-semibold" href="/admin/audit">Clear</Link>
          <span className="ml-auto text-xs text-[var(--muted)]">Maximum date range: 90 days</span>
        </div>
      </form>

      {filters.errors.length > 0 && <div className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-900" role="alert"><p className="font-semibold">Check the audit filters:</p><ul className="mt-2 list-disc pl-5">{filters.errors.map((error) => <li key={error}>{error}</li>)}</ul></div>}
      {hasDataError && <p className="mt-5 rounded-xl border border-[var(--gold)] bg-[var(--sand)] px-4 py-3 text-sm text-[var(--terracotta)]" role="alert">The audit log is temporarily unavailable or incomplete. Refresh to try again.</p>}

      <section className="mt-8 overflow-hidden rounded-2xl border border-[var(--line)] bg-white" aria-labelledby="audit-events-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-6 py-5">
          <div><h2 id="audit-events-heading" className="text-xl font-semibold">Events</h2><p className="mt-1 text-sm text-[var(--muted)]">{total} matching event{total === 1 ? "" : "s"} · newest first</p></div>
          <p className="text-sm text-[var(--muted)]">Page {filters.page}{totalPages ? ` of ${totalPages}` : ""}</p>
        </div>

        {rows.length === 0 ? <p className="p-6 text-sm text-[var(--muted)]">No audit events match these filters.</p> : <div className="divide-y divide-[var(--line)]">{rows.map((row) => {
          const safeMetadata = sanitizeMetadata(row.metadata);
          return <article className="grid gap-4 px-6 py-5 lg:grid-cols-[11rem_12rem_1fr_1.2fr]" key={String(row.id)}>
            <div><p className="text-xs font-semibold text-[var(--muted)]">{formatDate(row.created_at)} IST</p><p className="mt-1 font-mono text-xs">Event {row.id}</p></div>
            <div><p className="font-semibold capitalize">{label(row.action)}</p><p className="mt-1 text-xs text-[var(--muted)]">{row.entity_type}{row.entity_id ? ` · ${row.entity_id.slice(0, 8)}` : ""}</p></div>
            <div><p className="text-sm font-semibold">{row.actor_id ? actorNames.get(row.actor_id) ?? "Unknown actor" : "System"}</p><p className="mt-1 break-all font-mono text-xs text-[var(--muted)]">{row.actor_id ?? "No actor ID"}</p></div>
            <div><p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Sanitized metadata</p><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[var(--sand)] p-3 text-xs leading-5">{JSON.stringify(safeMetadata, null, 2)}</pre></div>
          </article>;
        })}</div>}
      </section>

      <nav className="mt-6 flex items-center justify-between" aria-label="Audit pagination">
        {filters.page > 1 ? <Link className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold" href={pageHref(filters, filters.page - 1)}>Previous page</Link> : <span />}
        {filters.page < totalPages ? <Link className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold" href={pageHref(filters, filters.page + 1)}>Next page</Link> : <span />}
      </nav>
    </section>
  </main>;
}
