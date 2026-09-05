import Link from "next/link";
import { redirect } from "next/navigation";
import VerificationDecisionForm from "@/components/admin/verification-decision-form";
import { createClient } from "@/lib/supabase/server";

type VerificationStatus = "submitted" | "in_review" | "changes_requested" | "approved" | "rejected";

type ChangeRequest = {
  id: string;
  fieldName: string;
  instruction: string;
  createdAt: string;
  resolvedAt: string | null;
};

type VerificationRequest = {
  id: string;
  property_id: string;
  property_name: string;
  property_slug: string;
  host_id: string;
  host_display_name: string | null;
  status: VerificationStatus;
  review_level: number;
  reviewer_id: string | null;
  reviewer_display_name: string | null;
  review_notes: string | null;
  submitted_at: string;
  claimed_at: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
  change_requests: unknown;
  total_count: number | string;
};

type PropertyDetails = {
  summary: string | null;
  address_line1: string;
  address_line2: string | null;
  locality: string | null;
  postal_code: string | null;
  status: string;
};

type PropertyDocument = {
  id: string;
  document_type: string;
  status: string;
  created_at: string;
  expires_on: string | null;
};

type Props = {
  searchParams: Promise<{ request?: string | string[] }>;
};

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

function label(value: string) {
  return value.replaceAll("_", " ");
}

function getChangeRequests(value: unknown): ChangeRequest[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ChangeRequest => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as Partial<ChangeRequest>;
    return typeof candidate.id === "string"
      && typeof candidate.fieldName === "string"
      && typeof candidate.instruction === "string"
      && typeof candidate.createdAt === "string"
      && (typeof candidate.resolvedAt === "string" || candidate.resolvedAt === null);
  });
}

export default async function VerificationPage({ searchParams }: Props) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: adminProfile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .eq("role", "admin")
    .maybeSingle();

  if (profileError) throw new Error("Unable to verify administrator access.");
  if (!adminProfile) redirect("/");

  const query = await searchParams;
  const requestedId = typeof query.request === "string" ? query.request : undefined;
  const { data, error } = await supabase.rpc("list_verification_requests", {
    p_status: null,
    p_review_level: null,
    p_limit: 100,
    p_offset: 0,
  });
  const requests = (data ?? []) as VerificationRequest[];
  const selected = requests.find((request) => request.id === requestedId) ?? requests[0] ?? null;
  const total = requests.length > 0 ? Number(requests[0].total_count) : 0;
  const activeCount = requests.filter((request) => request.status === "submitted" || request.status === "in_review").length;

  let property: PropertyDetails | null = null;
  let documents: PropertyDocument[] = [];
  let caseDetailsUnavailable = false;

  if (selected) {
    const [propertyResult, documentResult] = await Promise.all([
      supabase
        .from("properties")
        .select("summary,address_line1,address_line2,locality,postal_code,status")
        .eq("id", selected.property_id)
        .maybeSingle(),
      supabase
        .from("property_documents")
        .select("id,document_type,status,created_at,expires_on")
        .eq("property_id", selected.property_id)
        .order("created_at", { ascending: false }),
    ]);
    property = propertyResult.data as PropertyDetails | null;
    documents = (documentResult.data ?? []) as PropertyDocument[];
    caseDetailsUnavailable = Boolean(propertyResult.error || documentResult.error);
  }

  const changeRequests = selected ? getChangeRequests(selected.change_requests) : [];

  return <main className="min-h-screen bg-[var(--paper)]">
    <header className="border-b border-[var(--line)] bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
        <Link className="brand-mark font-bold" href="/">mizoram<span>stay</span></Link>
        <span className="rounded-full bg-[var(--deep)] px-3 py-1 text-sm font-semibold text-white">Administrator review</span>
      </div>
    </header>

    <section className="mx-auto max-w-7xl px-5 py-10">
      <p className="eyebrow">Verification review</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold">Marketplace review queue</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">{activeCount} active · {total} total case{total === 1 ? "" : "s"}</p>
        </div>
      </div>
      <p className="mt-6 rounded-xl border border-[var(--gold)] bg-[var(--sand)] px-4 py-3 text-sm leading-6">Internal Mizoramstay marketplace review only. A decision controls publication on this marketplace and does not represent certification, verification, or endorsement by any government authority.</p>

      {error ? <p className="mt-8 rounded-2xl bg-white p-6 text-sm text-[var(--terracotta)]" role="alert">The verification queue is temporarily unavailable. Refresh the page to try again.</p> : requests.length === 0 ? <section className="mt-8 rounded-2xl border border-dashed border-[var(--line)] bg-white p-8">
        <h2 className="text-xl font-semibold">No verification requests</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">New property submissions will appear here for internal marketplace review.</p>
      </section> : selected && <div className="mt-8 grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <aside aria-labelledby="queue-heading" className="self-start rounded-2xl border border-[var(--line)] bg-white p-4 lg:sticky lg:top-5">
          <h2 id="queue-heading" className="px-2 text-xl font-semibold">Cases</h2>
          <nav className="mt-4 max-h-[42rem] space-y-2 overflow-y-auto" aria-label="Verification requests">
            {requests.map((request) => {
              const isSelected = request.id === selected.id;
              return <Link key={request.id} href={`/admin/verification?request=${encodeURIComponent(request.id)}`} aria-current={isSelected ? "page" : undefined} className={`block rounded-xl border p-4 transition ${isSelected ? "border-[var(--forest)] bg-[var(--sky)]" : "border-[var(--line)] hover:bg-[var(--sand)]"}`}>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold leading-5">{request.property_name}</h3>
                  <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[.68rem] font-bold capitalize">{label(request.status)}</span>
                </div>
                <p className="mt-2 text-xs text-[var(--muted)]">{request.host_display_name || "Host name unavailable"}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">Level {request.review_level} · Submitted {formatDate(request.submitted_at)}</p>
              </Link>;
            })}
          </nav>
        </aside>

        <div className="min-w-0 space-y-6">
          <section className="rounded-2xl border border-[var(--line)] bg-white p-6" aria-labelledby="case-heading">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Case {selected.id}</p>
                <h2 id="case-heading" className="mt-2 text-3xl font-semibold">{selected.property_name}</h2>
                <p className="mt-2 text-sm text-[var(--muted)]">Submitted by {selected.host_display_name || "host name unavailable"}</p>
              </div>
              <span className="rounded-full bg-[var(--sand)] px-3 py-1.5 text-sm font-semibold capitalize">{label(selected.status)}</span>
            </div>

            {caseDetailsUnavailable && <p className="mt-5 rounded-xl bg-[var(--sand)] p-3 text-sm text-[var(--terracotta)]" role="alert">Some property or document details could not be loaded.</p>}
            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              <dl className="space-y-4 text-sm">
                <div><dt className="text-[var(--muted)]">Property ID</dt><dd className="mt-1 break-all font-semibold">{selected.property_id}</dd></div>
                <div><dt className="text-[var(--muted)]">Listing slug</dt><dd className="mt-1 font-semibold">{selected.property_slug}</dd></div>
                <div><dt className="text-[var(--muted)]">Address</dt><dd className="mt-1 font-semibold">{property ? [property.address_line1, property.address_line2, property.locality, property.postal_code].filter(Boolean).join(", ") : "Unavailable"}</dd></div>
                <div><dt className="text-[var(--muted)]">Listing status</dt><dd className="mt-1 font-semibold capitalize">{property ? label(property.status) : "Unavailable"}</dd></div>
              </dl>
              <dl className="space-y-4 text-sm">
                <div><dt className="text-[var(--muted)]">Review level</dt><dd className="mt-1 font-semibold">Level {selected.review_level}</dd></div>
                <div><dt className="text-[var(--muted)]">Submitted</dt><dd className="mt-1 font-semibold">{formatDate(selected.submitted_at)} IST</dd></div>
                <div><dt className="text-[var(--muted)]">Claimed</dt><dd className="mt-1 font-semibold">{formatDate(selected.claimed_at)}{selected.claimed_at ? " IST" : ""}</dd></div>
                <div><dt className="text-[var(--muted)]">Reviewer</dt><dd className="mt-1 font-semibold">{selected.reviewer_display_name || "Not assigned"}</dd></div>
              </dl>
            </div>
            {property?.summary && <div className="mt-6 border-t border-[var(--line)] pt-5"><h3 className="text-sm font-semibold">Listing summary</h3><p className="mt-2 text-sm leading-6 text-[var(--muted)]">{property.summary}</p></div>}
          </section>

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="rounded-2xl border border-[var(--line)] bg-white p-6" aria-labelledby="documents-heading">
              <h2 id="documents-heading" className="text-xl font-semibold">Submitted documents</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Document records linked to the property. Review status here is internal to Mizoramstay.</p>
              {documents.length ? <div className="mt-5 space-y-3">{documents.map((document) => <article className="rounded-xl bg-[var(--sand)] p-4" key={document.id}>
                <div className="flex items-start justify-between gap-3"><h3 className="font-semibold capitalize">{label(document.document_type)}</h3><span className="rounded-full bg-white px-2 py-1 text-xs font-semibold capitalize">{label(document.status)}</span></div>
                <p className="mt-2 text-xs text-[var(--muted)]">Added {formatDate(document.created_at)} IST{document.expires_on ? ` · Expires ${document.expires_on}` : ""}</p>
              </article>)}</div> : <p className="mt-5 rounded-xl bg-[var(--sand)] p-4 text-sm text-[var(--muted)]">No property document records are attached.</p>}
            </section>

            <section className="rounded-2xl border border-[var(--line)] bg-white p-6" aria-labelledby="history-heading">
              <h2 id="history-heading" className="text-xl font-semibold">Review record</h2>
              {selected.review_notes ? <div className="mt-5"><h3 className="text-sm font-semibold">Reviewer notes</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--muted)]">{selected.review_notes}</p></div> : <p className="mt-5 text-sm text-[var(--muted)]">No reviewer notes recorded.</p>}
              {selected.decided_at && <p className="mt-4 text-xs text-[var(--muted)]">Decision recorded {formatDate(selected.decided_at)} IST</p>}
              {changeRequests.length > 0 && <div className="mt-6 border-t border-[var(--line)] pt-5"><h3 className="text-sm font-semibold">Change items</h3><div className="mt-3 space-y-3">{changeRequests.map((item) => <article className="rounded-xl bg-[var(--sand)] p-4" key={item.id}><div className="flex items-start justify-between gap-3"><h4 className="font-semibold">{item.fieldName}</h4><span className="text-xs font-semibold">{item.resolvedAt ? "Resolved" : "Open"}</span></div><p className="mt-2 text-sm leading-6 text-[var(--muted)]">{item.instruction}</p></article>)}</div></div>}
            </section>
          </div>

          <VerificationDecisionForm requestId={selected.id} status={selected.status} reviewLevel={selected.review_level} reviewerId={selected.reviewer_id} currentUserId={user.id} />
        </div>
      </div>}
    </section>
  </main>;
}
