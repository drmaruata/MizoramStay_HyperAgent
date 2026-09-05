import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SupportCaseAdminActions, SupportCaseMessageForm } from "@/components/support/support-case-form";
import { createClient } from "@/lib/supabase/server";

type SupportStatus = "open" | "in_progress" | "waiting_on_customer" | "resolved" | "closed";
type SupportPriority = "low" | "normal" | "high" | "urgent";

type SupportCase = {
  id: string;
  customer_id: string | null;
  host_id: string | null;
  requester_display_name: string;
  requester_kind: "customer" | "host";
  booking_id: string | null;
  booking_check_in: string | null;
  booking_check_out: string | null;
  property_name: string | null;
  assigned_to: string | null;
  assignee_display_name: string | null;
  category: string;
  priority: SupportPriority;
  status: SupportStatus;
  subject: string;
  resolution_summary: string | null;
  assigned_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  message_count: number | string;
  last_message_at: string | null;
  total_count: number | string;
};

type SupportMessage = {
  id: string;
  author_id: string;
  body: string;
  is_internal: boolean;
  created_at: string;
};

type Props = { searchParams: Promise<{ case?: string | string[] }> };

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Support operations",
  description: "Administrator support case assignment and resolution queue.",
};

const priorityClass: Record<SupportPriority, string> = {
  low: "bg-[var(--sand)] text-[var(--muted)]",
  normal: "bg-[var(--sky)] text-[var(--deep)]",
  high: "bg-amber-100 text-amber-900",
  urgent: "bg-red-100 text-red-900",
};

function label(value: string) {
  return value.replaceAll("_", " ");
}

function formatDate(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

export default async function AdminSupportPage({ searchParams }: Props) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect(`/login?next=${encodeURIComponent("/admin/support")}`);

  const { data: adminProfile, error: profileError } = await supabase
    .from("profiles")
    .select("id,display_name")
    .eq("id", user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (profileError) throw new Error("Unable to verify administrator access.");
  if (!adminProfile) redirect("/");

  const query = await searchParams;
  const requestedId = typeof query.case === "string" ? query.case : undefined;
  const casesResult = await supabase.rpc("list_support_cases", {
    p_status: null,
    p_priority: null,
    p_limit: 100,
    p_offset: 0,
  });
  const cases = (casesResult.data ?? []) as SupportCase[];
  const selected = cases.find((supportCase) => supportCase.id === requestedId) ?? cases[0] ?? null;
  let messages: SupportMessage[] = [];
  let messagesError = false;

  if (selected) {
    const result = await supabase
      .from("support_case_messages")
      .select("id,author_id,body,is_internal,created_at")
      .eq("support_case_id", selected.id)
      .order("created_at", { ascending: true });
    messages = (result.data ?? []) as SupportMessage[];
    messagesError = Boolean(result.error);
  }

  const activeCount = cases.filter((supportCase) => !["resolved", "closed"].includes(supportCase.status)).length;
  const urgentCount = cases.filter((supportCase) => supportCase.priority === "urgent" && !["resolved", "closed"].includes(supportCase.status)).length;
  const unassignedCount = cases.filter((supportCase) => !supportCase.assigned_to && !["resolved", "closed"].includes(supportCase.status)).length;
  const total = cases.length > 0 ? Number(cases[0].total_count) : 0;
  const closed = selected?.status === "resolved" || selected?.status === "closed";

  return (
    <main className="min-h-screen bg-[var(--paper)]">
      <header className="border-b border-[var(--line)] bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <Link className="brand-mark text-xl font-bold" href="/">mizoram<span>stay</span></Link>
          <span className="rounded-full bg-[var(--deep)] px-3 py-1 text-sm font-semibold text-white">Support operations</span>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-5 py-10">
        <p className="eyebrow">Administrator workspace</p>
        <h1 className="mt-2 text-4xl font-semibold">Support case queue</h1>
        <p className="mt-3 max-w-3xl leading-7 text-[var(--muted)]">Assign, reply to, and resolve private customer and host cases. Contact details are intentionally not shown in this queue.</p>

        <div className="mt-7 grid gap-4 sm:grid-cols-3">
          <article className="rounded-2xl border border-[var(--line)] bg-white p-5"><p className="text-3xl font-semibold">{activeCount}</p><p className="mt-1 text-sm text-[var(--muted)]">Active cases</p></article>
          <article className="rounded-2xl border border-[var(--line)] bg-white p-5"><p className="text-3xl font-semibold">{urgentCount}</p><p className="mt-1 text-sm text-[var(--muted)]">Urgent active</p></article>
          <article className="rounded-2xl border border-[var(--line)] bg-white p-5"><p className="text-3xl font-semibold">{unassignedCount}</p><p className="mt-1 text-sm text-[var(--muted)]">Unassigned</p></article>
        </div>

        {casesResult.error ? <p className="mt-8 rounded-2xl bg-red-50 p-6 text-sm text-red-800" role="alert">The support queue is temporarily unavailable. Refresh the page to try again.</p> : cases.length === 0 ? <section className="mt-8 rounded-2xl border border-dashed border-[var(--line)] bg-white p-8">
          <h2 className="text-xl font-semibold">No support cases</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">New customer and host cases will appear here.</p>
        </section> : selected && <div className="mt-8 grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <aside className="self-start rounded-2xl border border-[var(--line)] bg-white p-4 lg:sticky lg:top-5" aria-labelledby="queue-heading">
            <div className="flex items-center justify-between px-2"><h2 className="text-xl font-semibold" id="queue-heading">Cases</h2><span className="text-xs text-[var(--muted)]">{total} total</span></div>
            <nav className="mt-4 max-h-[48rem] space-y-2 overflow-y-auto" aria-label="Support case queue">
              {cases.map((supportCase) => {
                const isSelected = supportCase.id === selected.id;
                return <Link key={supportCase.id} href={`/admin/support?case=${encodeURIComponent(supportCase.id)}`} aria-current={isSelected ? "page" : undefined} className={`block rounded-xl border p-4 ${isSelected ? "border-[var(--forest)] bg-[var(--sky)]" : "border-[var(--line)] hover:bg-[var(--sand)]"}`}>
                  <div className="flex items-start justify-between gap-2"><h3 className="font-semibold leading-5">{supportCase.subject}</h3><span className={`rounded-full px-2 py-1 text-[.68rem] font-bold capitalize ${priorityClass[supportCase.priority]}`}>{supportCase.priority}</span></div>
                  <p className="mt-2 text-xs text-[var(--muted)]">{supportCase.requester_display_name} · <span className="capitalize">{supportCase.requester_kind}</span></p>
                  <p className="mt-1 text-xs capitalize text-[var(--muted)]">{label(supportCase.status)} · {supportCase.assignee_display_name ?? "Unassigned"}</p>
                </Link>;
              })}
            </nav>
          </aside>

          <div className="min-w-0 space-y-6">
            <section className="rounded-2xl border border-[var(--line)] bg-white p-6" aria-labelledby="case-heading">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div><p className="font-mono text-xs text-[var(--muted)]">CASE {selected.id.toUpperCase()}</p><h2 className="mt-2 text-3xl font-semibold" id="case-heading">{selected.subject}</h2><p className="mt-2 text-sm text-[var(--muted)]">Opened by {selected.requester_display_name} · <span className="capitalize">{selected.requester_kind}</span></p></div>
                <div className="flex gap-2"><span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${priorityClass[selected.priority]}`}>{selected.priority}</span><span className="rounded-full bg-[var(--sand)] px-3 py-1 text-xs font-semibold capitalize">{label(selected.status)}</span></div>
              </div>
              <dl className="mt-6 grid gap-5 border-t border-[var(--line)] pt-5 text-sm sm:grid-cols-2 xl:grid-cols-4">
                <div><dt className="text-[var(--muted)]">Category</dt><dd className="mt-1 font-semibold capitalize">{label(selected.category)}</dd></div>
                <div><dt className="text-[var(--muted)]">Opened</dt><dd className="mt-1 font-semibold">{formatDate(selected.created_at)} IST</dd></div>
                <div><dt className="text-[var(--muted)]">Assignment</dt><dd className="mt-1 font-semibold">{selected.assignee_display_name ?? "Unassigned"}</dd></div>
                <div><dt className="text-[var(--muted)]">Last activity</dt><dd className="mt-1 font-semibold">{formatDate(selected.last_message_at ?? selected.updated_at)} IST</dd></div>
              </dl>
              {selected.booking_id && <div className="mt-5 rounded-xl bg-[var(--sand)] p-4 text-sm"><p className="font-semibold">Linked booking</p><p className="mt-1 text-[var(--muted)]">{selected.property_name ?? "Property unavailable"} · {selected.booking_check_in ?? "date unavailable"} to {selected.booking_check_out ?? "date unavailable"} · {selected.booking_id}</p></div>}
              {selected.resolution_summary && <div className="mt-5 rounded-xl bg-emerald-50 p-4"><h3 className="font-semibold text-emerald-900">Resolution summary</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-emerald-950">{selected.resolution_summary}</p></div>}
            </section>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(18rem,.7fr)]">
              <section className="rounded-2xl border border-[var(--line)] bg-white p-6" aria-labelledby="conversation-heading">
                <h2 className="text-xl font-semibold" id="conversation-heading">Conversation</h2>
                {messagesError ? <p className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800" role="alert">Messages could not be loaded.</p> : <div className="mt-5 space-y-3">
                  {messages.map((message) => {
                    const requesterId = selected.customer_id ?? selected.host_id;
                    const authorLabel = message.author_id === requesterId ? selected.requester_display_name : message.author_id === user.id ? "You" : "Support administrator";
                    return <article key={message.id} className={`rounded-xl p-4 ${message.is_internal ? "border border-amber-200 bg-amber-50" : message.author_id === requesterId ? "bg-[var(--sand)]" : "bg-[var(--sky)]"}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted)]"><span className="font-semibold text-[var(--ink)]">{authorLabel}{message.is_internal ? " · Internal note" : ""}</span><time dateTime={message.created_at}>{formatDate(message.created_at)} IST</time></div>
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{message.body}</p>
                    </article>;
                  })}
                </div>}
                {!messagesError && <SupportCaseMessageForm caseId={selected.id} allowInternal disabled={closed} />}
              </section>

              <section className="self-start rounded-2xl border border-[var(--line)] bg-white p-6" aria-labelledby="actions-heading">
                <h2 className="text-xl font-semibold" id="actions-heading">Case actions</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Assignment and resolution are atomic, audited operations. Resolution notifies the requester through the outbox.</p>
                <SupportCaseAdminActions caseId={selected.id} status={selected.status} priority={selected.priority} assignedTo={selected.assigned_to} currentUserId={user.id} />
              </section>
            </div>
          </div>
        </div>}
      </section>
    </main>
  );
}
