import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import SupportCaseForm, { SupportCaseMessageForm, type SupportBookingOption } from "@/components/support/support-case-form";
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
  created_at: string;
  updated_at: string;
  message_count: number | string;
  total_count: number | string;
};

type SupportMessage = {
  id: string;
  author_id: string;
  body: string;
  created_at: string;
};

type BookingRow = {
  id: string;
  check_in: string;
  check_out: string;
  properties: { name: string } | { name: string }[] | null;
};

type Props = { searchParams: Promise<{ case?: string | string[] }> };

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Support",
  description: "Open and follow private support cases with MizoramStay.",
};

const priorityClass: Record<SupportPriority, string> = {
  low: "bg-[var(--sand)] text-[var(--muted)]",
  normal: "bg-[var(--sky)] text-[var(--deep)]",
  high: "bg-amber-100 text-amber-900",
  urgent: "bg-red-50 text-red-800",
};

function one<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function label(value: string) {
  return value.replaceAll("_", " ");
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

function bookingLabel(booking: BookingRow) {
  const property = one(booking.properties);
  const dates = `${booking.check_in} to ${booking.check_out}`;
  return `${property?.name ?? "Property unavailable"} · ${dates} · ${booking.id.slice(0, 8).toUpperCase()}`;
}

export default async function SupportPage({ searchParams }: Props) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect(`/login?next=${encodeURIComponent("/support")}`);

  const query = await searchParams;
  const requestedId = typeof query.case === "string" ? query.case : undefined;
  const [casesResult, bookingsResult] = await Promise.all([
    supabase.rpc("list_support_cases", {
      p_status: null,
      p_priority: null,
      p_limit: 100,
      p_offset: 0,
    }),
    supabase
      .from("bookings")
      .select("id,check_in,check_out,properties:property_id(name)")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const cases = (casesResult.data ?? []) as SupportCase[];
  const selected = cases.find((supportCase) => supportCase.id === requestedId) ?? cases[0] ?? null;
  const bookings = (bookingsResult.data ?? []) as unknown as BookingRow[];
  const bookingOptions: SupportBookingOption[] = bookings.map((booking) => ({ id: booking.id, label: bookingLabel(booking) }));
  let messages: SupportMessage[] = [];
  let messagesError = false;

  if (selected) {
    const result = await supabase
      .from("support_case_messages")
      .select("id,author_id,body,created_at")
      .eq("support_case_id", selected.id)
      .eq("is_internal", false)
      .order("created_at", { ascending: true });
    messages = (result.data ?? []) as SupportMessage[];
    messagesError = Boolean(result.error);
  }

  const loadError = Boolean(casesResult.error || bookingsResult.error);
  const closed = selected?.status === "resolved" || selected?.status === "closed";

  return (
    <main className="min-h-screen bg-[var(--paper)]">
      <header className="border-b border-[var(--line)] bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <Link className="brand-mark text-xl font-bold" href="/">mizoram<span>stay</span></Link>
          <Link className="text-sm font-semibold" href="/account">Your account</Link>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-5 py-10">
        <p className="eyebrow">Private support</p>
        <h1 className="serif mt-2 text-4xl sm:text-5xl">How can we help?</h1>
        <p className="mt-3 max-w-2xl leading-7 text-[var(--muted)]">Open a case, link an eligible booking, and keep the conversation in one private thread.</p>

        {loadError && <p className="mt-6 rounded-xl bg-red-50 p-4 text-sm text-red-800" role="alert">Some support or booking records could not be loaded. Refresh before submitting or relying on the list.</p>}

        <div className="mt-9 grid gap-7 xl:grid-cols-[23rem_minmax(0,1fr)]">
          <div className="space-y-7">
            <section className="rounded-2xl border border-[var(--line)] bg-white p-6" aria-labelledby="new-case-heading">
              <h2 className="text-2xl font-semibold" id="new-case-heading">Open a new case</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Do not include payment card details, passwords, or identity document numbers.</p>
              <div className="mt-6"><SupportCaseForm bookings={bookingOptions} /></div>
            </section>
          </div>

          <section aria-labelledby="your-cases-heading">
            <div className="flex items-end justify-between gap-3">
              <div><p className="eyebrow">Case history</p><h2 className="mt-2 text-3xl font-semibold" id="your-cases-heading">Your cases</h2></div>
              <p className="text-sm text-[var(--muted)]">{cases.length} case{cases.length === 1 ? "" : "s"}</p>
            </div>

            {cases.length === 0 ? <div className="mt-5 rounded-2xl border border-dashed border-[var(--line)] bg-white p-7">
              <h3 className="text-lg font-semibold">No support cases yet</h3>
              <p className="mt-2 text-sm text-[var(--muted)]">Cases you open will appear here with their live status.</p>
            </div> : selected && <div className="mt-5 grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
              <nav className="space-y-2" aria-label="Your support cases">
                {cases.map((supportCase) => {
                  const isSelected = supportCase.id === selected.id;
                  return <Link key={supportCase.id} href={`/support?case=${encodeURIComponent(supportCase.id)}`} aria-current={isSelected ? "page" : undefined} className={`block rounded-xl border p-4 ${isSelected ? "border-[var(--forest)] bg-[var(--sky)]" : "border-[var(--line)] bg-white hover:bg-[var(--sand)]"}`}>
                    <div className="flex items-start justify-between gap-2"><h3 className="font-semibold leading-5">{supportCase.subject}</h3><span className={`rounded-full px-2 py-1 text-[.68rem] font-bold capitalize ${priorityClass[supportCase.priority]}`}>{supportCase.priority}</span></div>
                    <p className="mt-2 text-xs capitalize text-[var(--muted)]">{label(supportCase.status)} · {supportCase.message_count} message{Number(supportCase.message_count) === 1 ? "" : "s"}</p>
                  </Link>;
                })}
              </nav>

              <article className="min-w-0 rounded-2xl border border-[var(--line)] bg-white p-5 sm:p-7">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div><p className="font-mono text-xs text-[var(--muted)]">CASE {selected.id.slice(0, 8).toUpperCase()}</p><h2 className="mt-2 text-2xl font-semibold">{selected.subject}</h2></div>
                  <div className="flex gap-2"><span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${priorityClass[selected.priority]}`}>{selected.priority}</span><span className="rounded-full bg-[var(--sand)] px-3 py-1 text-xs font-semibold capitalize">{label(selected.status)}</span></div>
                </div>
                <dl className="mt-6 grid gap-4 border-y border-[var(--line)] py-5 text-sm sm:grid-cols-2">
                  <div><dt className="text-[var(--muted)]">Category</dt><dd className="mt-1 font-semibold capitalize">{label(selected.category)}</dd></div>
                  <div><dt className="text-[var(--muted)]">Opened</dt><dd className="mt-1 font-semibold">{formatDate(selected.created_at)} IST</dd></div>
                  <div><dt className="text-[var(--muted)]">Booking</dt><dd className="mt-1 font-semibold">{selected.booking_id ? `${selected.property_name ?? "Property unavailable"} · ${selected.booking_id.slice(0, 8).toUpperCase()}` : "Not linked"}</dd></div>
                  <div><dt className="text-[var(--muted)]">Assigned support</dt><dd className="mt-1 font-semibold">{selected.assignee_display_name ?? "Queue pending"}</dd></div>
                </dl>

                <section className="mt-6" aria-labelledby="conversation-heading">
                  <h3 className="text-lg font-semibold" id="conversation-heading">Conversation</h3>
                  {messagesError ? <p className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800" role="alert">Messages could not be loaded.</p> : <div className="mt-4 space-y-3">
                    {messages.map((message) => {
                      const ownMessage = message.author_id === user.id;
                      return <div key={message.id} className={`rounded-xl p-4 ${ownMessage ? "ml-5 bg-[var(--sand)]" : "mr-5 bg-[var(--sky)]"}`}>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted)]"><span className="font-semibold text-[var(--ink)]">{ownMessage ? "You" : "MizoramStay support"}</span><time dateTime={message.created_at}>{formatDate(message.created_at)} IST</time></div>
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{message.body}</p>
                      </div>;
                    })}
                  </div>}
                </section>

                {selected.resolution_summary && <section className="mt-6 rounded-xl bg-emerald-50 p-4"><h3 className="font-semibold text-emerald-900">Resolution</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-emerald-950">{selected.resolution_summary}</p></section>}
                {!messagesError && <SupportCaseMessageForm caseId={selected.id} disabled={closed} />}
                {closed && <p className="mt-4 text-sm text-[var(--muted)]">This case is resolved. Open a new case if you need more help.</p>}
              </article>
            </div>}
          </section>
        </div>
      </section>
    </main>
  );
}
