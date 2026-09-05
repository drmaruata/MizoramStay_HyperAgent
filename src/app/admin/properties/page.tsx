import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type PropertyRow = {
  id: string;
  slug: string;
  name: string;
  status: "draft" | "submitted" | "published" | "archived";
  summary: string | null;
  locality: string | null;
  max_guests: number;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  host: { display_name: string } | { display_name: string }[] | null;
  destination: { name: string; slug: string } | { name: string; slug: string }[] | null;
  rooms: { id: string; is_active: boolean; base_nightly_rate: number | string; currency_code: string }[] | null;
  property_media: { id: string }[] | null;
  verification_requests: { id: string; status: string; review_level: number; submitted_at: string }[] | null;
};

type Props = {
  searchParams: Promise<{ status?: string | string[] }>;
};

function one<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function label(value: string) {
  return value.replaceAll("_", " ");
}

function money(amount: number, currency: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(value: string | null) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

export default async function PropertiesPage({ searchParams }: Props) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/admin/properties")}`);

  const { data: adminProfile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .eq("role", "admin")
    .maybeSingle();

  if (profileError) throw new Error("Unable to verify administrator access.");
  if (!adminProfile) redirect("/");

  const requestedStatus = one((await searchParams).status);
  const status = ["draft", "submitted", "published", "archived"].includes(requestedStatus ?? "")
    ? requestedStatus
    : undefined;

  let query = supabase
    .from("properties")
    .select(`
      id,
      slug,
      name,
      status,
      summary,
      locality,
      max_guests,
      created_at,
      updated_at,
      published_at,
      host:profiles!properties_host_id_fkey(display_name),
      destination:destinations!inner(name,slug),
      rooms(id,is_active,base_nightly_rate,currency_code),
      property_media(id),
      verification_requests(id,status,review_level,submitted_at)
    `)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (status) {
    query = query.eq("status", status);
  }

  const [propertyResult, countResult] = await Promise.all([
    query,
    supabase.from("properties").select("status").limit(1000),
  ]);
  const { data, error } = propertyResult;
  const properties = (data ?? []) as unknown as PropertyRow[];
  const statusCounts = ((countResult.data ?? []) as { status: string }[]).reduce<Record<string, number>>((counts, property) => {
    counts[property.status] = (counts[property.status] ?? 0) + 1;
    return counts;
  }, {});

  return (
    <main className="min-h-screen bg-[var(--paper)]">
      <header className="border-b border-[var(--line)] bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <Link className="brand-mark font-bold" href="/">mizoram<span>stay</span></Link>
          <Link className="text-sm font-semibold" href="/admin">Admin dashboard</Link>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-5 py-10">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="eyebrow">Property moderation</p>
            <h1 className="mt-2 text-4xl font-semibold">Marketplace listings</h1>
            <p className="mt-2 max-w-2xl text-[var(--muted)]">Live property records across onboarding, review, publication, and archive states.</p>
          </div>
          <Link className="rounded-full bg-[var(--deep)] px-4 py-2 text-sm font-semibold text-white" href="/admin/verification">Open verification queue</Link>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-4">
          {["draft", "submitted", "published", "archived"].map((item) => (
            <Link href={item === status ? "/admin/properties" : `/admin/properties?status=${item}`} key={item} className={`rounded-2xl border p-5 ${item === status ? "border-[var(--forest)] bg-[var(--sky)]" : "border-[var(--line)] bg-white"}`}>
              <p className="text-3xl font-semibold">{statusCounts[item] ?? 0}</p>
              <p className="mt-1 text-sm capitalize text-[var(--muted)]">{label(item)}</p>
            </Link>
          ))}
        </div>

        {error ? (
          <p className="mt-8 rounded-2xl bg-white p-6 text-sm text-[var(--terracotta)]" role="alert">Properties are temporarily unavailable. Refresh the page to try again.</p>
        ) : properties.length === 0 ? (
          <section className="mt-8 rounded-2xl border border-dashed border-[var(--line)] bg-white p-8">
            <h2 className="text-xl font-semibold">No properties found</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">New host listings will appear here after hosts begin onboarding.</p>
          </section>
        ) : (
          <section className="mt-8 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
            <div className="flex flex-col gap-3 border-b border-[var(--line)] px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold">Listing records</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">{properties.length} record{properties.length === 1 ? "" : "s"} loaded</p>
              </div>
              {status && <Link className="text-sm font-semibold text-[var(--forest)] underline underline-offset-4" href="/admin/properties">Clear status filter</Link>}
            </div>
            <div className="divide-y divide-[var(--line)]">
              {properties.map((property) => {
                const host = one(property.host);
                const destination = one(property.destination);
                const verification = property.verification_requests?.toSorted((first, second) => Date.parse(second.submitted_at) - Date.parse(first.submitted_at))[0] ?? null;
                const activeRooms = property.rooms?.filter((room) => room.is_active) ?? [];
                const rates = activeRooms.map((room) => Number(room.base_nightly_rate)).filter(Number.isFinite);
                const lowestRate = rates.length ? Math.min(...rates) : 0;
                const currency = activeRooms[0]?.currency_code ?? "INR";

                return (
                  <article key={property.id} className="grid gap-4 px-6 py-5 md:grid-cols-[1.4fr_1fr_1fr_auto] md:items-center">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold">{property.name}</h3>
                        <span className="rounded-full bg-[var(--sand)] px-2 py-0.5 text-xs font-semibold capitalize">{label(property.status)}</span>
                      </div>
                      <p className="mt-1 text-sm text-[var(--muted)]">{destination?.name ?? "Mizoram"}{property.locality ? `, ${property.locality}` : ""} · Host: {host?.display_name ?? "Unassigned"}</p>
                      <p className="mt-2 line-clamp-2 text-sm leading-6 text-[var(--muted)]">{property.summary ?? "No summary added yet."}</p>
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Marketplace readiness</p>
                      <p className="mt-1 text-sm font-semibold">{activeRooms.length} active room{activeRooms.length === 1 ? "" : "s"} · {property.property_media?.length ?? 0} media item{property.property_media?.length === 1 ? "" : "s"}</p>
                      <p className="mt-1 text-sm text-[var(--muted)]">Up to {property.max_guests} guest{property.max_guests === 1 ? "" : "s"}</p>
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Review state</p>
                      <p className="mt-1 text-sm font-semibold">{verification ? label(verification.status) : "No request"}</p>
                      <p className="mt-1 text-sm text-[var(--muted)]">{lowestRate ? `From ${money(lowestRate, currency)}` : "Rate pending"} · Updated {formatDate(property.updated_at)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2 md:justify-end">
                      {property.status === "published" && <Link className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-semibold" href={`/stays/${property.slug}`}>View</Link>}
                      {verification ? <Link className="rounded-full border border-[var(--forest)] px-4 py-2 text-sm font-semibold text-[var(--forest)]" href={`/admin/verification?request=${encodeURIComponent(verification.id)}`}>Review</Link> : <span className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-semibold text-[var(--muted)]">Awaiting host</span>}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
