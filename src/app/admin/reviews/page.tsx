import Link from "next/link";
import { redirect } from "next/navigation";
import ReviewModerationForm from "@/components/reviews/review-moderation-form";
import { createClient } from "@/lib/supabase/server";

type ReviewRow = {
  id: string;
  booking_id: string;
  guest_id: string;
  property_id: string;
  rating: number;
  title: string | null;
  body: string;
  moderation_status: "pending";
  created_at: string;
};

type PropertyRow = { id: string; name: string; slug: string };
type ProfileRow = { id: string; display_name: string };
type Props = { searchParams: Promise<{ review?: string | string[] }> };

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export default async function ReviewModerationPage({ searchParams }: Props) {
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

  // All reads use the authenticated server client. The reviews, properties, and
  // profiles policies independently enforce administrator-only access to private rows.
  const reviewResult = await supabase
    .from("reviews")
    .select("id,booking_id,guest_id,property_id,rating,title,body,moderation_status,created_at", { count: "exact" })
    .eq("moderation_status", "pending")
    .order("created_at", { ascending: true })
    .limit(100);

  const reviews = (reviewResult.data ?? []) as ReviewRow[];
  const propertyIds = [...new Set(reviews.map((review) => review.property_id))];
  const guestIds = [...new Set(reviews.map((review) => review.guest_id))];
  const [propertyResult, profileResult] = await Promise.all([
    propertyIds.length
      ? supabase.from("properties").select("id,name,slug").in("id", propertyIds)
      : Promise.resolve({ data: [] as PropertyRow[], error: null }),
    guestIds.length
      ? supabase.from("profiles").select("id,display_name").in("id", guestIds)
      : Promise.resolve({ data: [] as ProfileRow[], error: null }),
  ]);

  const properties = new Map(((propertyResult.data ?? []) as PropertyRow[]).map((property) => [property.id, property]));
  const guests = new Map(((profileResult.data ?? []) as ProfileRow[]).map((profile) => [profile.id, profile.display_name]));
  const params = await searchParams;
  const requestedId = typeof params.review === "string" && isUuid(params.review) ? params.review : undefined;
  const selected = reviews.find((review) => review.id === requestedId) ?? reviews[0] ?? null;
  const hasDataError = Boolean(reviewResult.error || propertyResult.error || profileResult.error);
  const total = reviewResult.count ?? reviews.length;

  return <main className="min-h-screen bg-[var(--paper)]">
    <header className="border-b border-[var(--line)] bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
        <Link className="brand-mark font-bold" href="/">mizoram<span>stay</span></Link>
        <span className="rounded-full bg-[var(--deep)] px-3 py-1 text-sm font-semibold text-white">Administrator moderation</span>
      </div>
    </header>

    <section className="mx-auto max-w-7xl px-5 py-10">
      <p className="eyebrow">Review safety</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold">Pending review queue</h1>
          <p className="mt-2 text-[var(--muted)]">Moderate guest reviews before they appear on the marketplace.</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="rounded-full bg-[var(--sand)] px-3 py-2 font-semibold">{total} pending</span>
          <Link className="font-semibold text-[var(--forest)] underline underline-offset-4" href="/admin/audit?entity=review">Open audit log</Link>
        </div>
      </div>

      {hasDataError && <p className="mt-6 rounded-xl border border-[var(--gold)] bg-[var(--sand)] px-4 py-3 text-sm text-[var(--terracotta)]" role="alert">Some moderation data could not be loaded. Do not decide a case until all details are visible.</p>}

      {!reviewResult.error && reviews.length === 0 ? <section className="mt-8 rounded-2xl border border-dashed border-[var(--line)] bg-white p-8">
        <h2 className="text-xl font-semibold">Queue clear</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">There are no guest reviews awaiting moderation.</p>
      </section> : selected && <div className="mt-8 grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <aside className="self-start rounded-2xl border border-[var(--line)] bg-white p-4 lg:sticky lg:top-5" aria-labelledby="review-queue-heading">
          <h2 id="review-queue-heading" className="px-2 text-xl font-semibold">Awaiting decision</h2>
          <p className="px-2 pt-1 text-xs text-[var(--muted)]">Oldest first · up to 100 shown</p>
          <nav className="mt-4 max-h-[42rem] space-y-2 overflow-y-auto" aria-label="Pending reviews">
            {reviews.map((review) => {
              const property = properties.get(review.property_id);
              const isSelected = review.id === selected.id;
              return <Link
                key={review.id}
                href={`/admin/reviews?review=${encodeURIComponent(review.id)}`}
                aria-current={isSelected ? "page" : undefined}
                className={`block rounded-xl border p-4 transition ${isSelected ? "border-[var(--forest)] bg-[var(--sky)]" : "border-[var(--line)] hover:bg-[var(--sand)]"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold leading-5">{property?.name ?? "Property unavailable"}</h3>
                  <span className="shrink-0 text-sm font-bold" aria-label={`${review.rating} out of 5 stars`}>{review.rating}/5</span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-[var(--muted)]">{review.title || review.body}</p>
                <p className="mt-2 text-xs text-[var(--muted)]">Submitted {formatDate(review.created_at)} IST</p>
              </Link>;
            })}
          </nav>
        </aside>

        <div className="min-w-0 space-y-6">
          <section className="rounded-2xl border border-[var(--line)] bg-white p-6" aria-labelledby="selected-review-heading">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Pending review</p>
                <h2 id="selected-review-heading" className="mt-2 text-3xl font-semibold">{selected.title || "Untitled guest review"}</h2>
                <p className="mt-2 text-sm text-[var(--muted)]">For {properties.get(selected.property_id)?.name ?? "property unavailable"} · by {guests.get(selected.guest_id) ?? "guest unavailable"}</p>
              </div>
              <span className="rounded-full bg-[var(--sand)] px-3 py-1.5 text-lg font-semibold" aria-label={`${selected.rating} out of 5 stars`}>{selected.rating}/5</span>
            </div>

            <div className="mt-6 rounded-2xl bg-[var(--sand)] p-5">
              <p className="whitespace-pre-wrap text-base leading-7">{selected.body}</p>
            </div>

            <dl className="mt-6 grid gap-4 border-t border-[var(--line)] pt-5 text-sm sm:grid-cols-2">
              <div><dt className="text-[var(--muted)]">Submitted</dt><dd className="mt-1 font-semibold">{formatDate(selected.created_at)} IST</dd></div>
              <div><dt className="text-[var(--muted)]">Property</dt><dd className="mt-1 font-semibold">{properties.get(selected.property_id) ? <Link className="underline underline-offset-4" href={`/properties/${properties.get(selected.property_id)!.slug}`}>{properties.get(selected.property_id)!.name}</Link> : "Unavailable"}</dd></div>
              <div><dt className="text-[var(--muted)]">Review ID</dt><dd className="mt-1 break-all font-mono text-xs">{selected.id}</dd></div>
              <div><dt className="text-[var(--muted)]">Booking ID</dt><dd className="mt-1 break-all font-mono text-xs">{selected.booking_id}</dd></div>
            </dl>
          </section>

          <ReviewModerationForm reviewId={selected.id} />
        </div>
      </div>}
    </section>
  </main>;
}
