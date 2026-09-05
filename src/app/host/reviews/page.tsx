import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import HostResponseForm from "@/components/reviews/host-response-form";
import { createClient } from "@/lib/supabase/server";

type PropertySummary = {
  id: string;
  name: string;
};

type BookingSummary = {
  id: string;
  contact_name: string;
  check_in: string;
  check_out: string;
};

type HostReview = {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  is_published: boolean;
  moderation_status: "pending" | "approved" | "rejected";
  host_response: string | null;
  responded_at: string | null;
  created_at: string;
  properties: PropertySummary | PropertySummary[] | null;
  bookings: BookingSummary | BookingSummary[] | null;
};

const moderationPresentation: Record<HostReview["moderation_status"], { label: string; className: string }> = {
  pending: { label: "Awaiting moderation", className: "bg-[var(--gold)] text-[var(--deep)]" },
  approved: { label: "Published", className: "bg-emerald-100 text-emerald-900" },
  rejected: { label: "Not published", className: "bg-red-50 text-red-800" },
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Host reviews",
  description: "Read guest reviews and respond to published feedback for your MizoramStay properties.",
};

function one<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value.length === 10 ? `${value}T00:00:00Z` : value));
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[var(--paper)]">
      <header className="border-b border-[var(--line)] bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link href="/" className="brand-mark text-lg font-bold">mizoram<span>stay</span></Link>
          <Link href="/host/dashboard" className="text-sm font-semibold">Host dashboard</Link>
        </div>
      </header>
      <section className="mx-auto max-w-5xl px-5 py-9 sm:py-12">
        <p className="eyebrow">Guest feedback</p>
        <h1 className="serif mt-2 text-4xl sm:text-5xl">Reviews</h1>
        <p className="mt-3 text-[var(--muted)]">Verified-stay feedback for properties you own. New reviews remain private until moderation.</p>
        {children}
      </section>
    </main>
  );
}

function LoadError() {
  return (
    <PageShell>
      <div className="mt-8 rounded-2xl border border-red-200 bg-white p-6" role="alert">
        <h2 className="text-lg font-semibold">Reviews could not be loaded</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">We could not retrieve your guest feedback right now. Please refresh the page or try again later.</p>
      </div>
    </PageShell>
  );
}

export default async function HostReviewsPage() {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return <LoadError />;
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) return <LoadError />;
  if (!user) redirect(`/login?next=${encodeURIComponent("/host/reviews")}`);

  // Explicitly discover the caller's properties before querying reviews. Both reads use the
  // authenticated publishable-key client, so RLS remains authoritative and public reviews for
  // unrelated properties cannot accidentally enter the host dashboard.
  const { data: properties, error: propertiesError } = await supabase
    .from("properties")
    .select("id")
    .eq("host_id", user.id);

  if (propertiesError) return <LoadError />;

  const propertyIds = properties.map((property) => property.id);
  let reviews: HostReview[] = [];
  if (propertyIds.length > 0) {
    const { data, error } = await supabase
      .from("reviews")
      .select(`
        id,
        rating,
        title,
        body,
        is_published,
        moderation_status,
        host_response,
        responded_at,
        created_at,
        properties:property_id (id, name),
        bookings:booking_id (id, contact_name, check_in, check_out)
      `)
      .in("property_id", propertyIds)
      .order("created_at", { ascending: false });

    if (error) return <LoadError />;
    reviews = (data ?? []) as unknown as HostReview[];
  }

  const approvedReviews = reviews.filter((review) => review.moderation_status === "approved" && review.is_published);
  const averageRating = approvedReviews.length > 0
    ? approvedReviews.reduce((sum, review) => sum + review.rating, 0) / approvedReviews.length
    : null;
  const awaitingResponse = approvedReviews.filter((review) => !review.host_response).length;

  return (
    <PageShell>
      <div className="mt-7 rounded-2xl bg-[var(--deep)] p-6 text-white sm:flex sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-white/70">Published guest rating</p>
          <p className="mt-2 text-4xl font-semibold">
            {averageRating === null ? "—" : averageRating.toFixed(1)} <span className="text-lg text-[var(--gold)]" aria-hidden="true">★★★★★</span>
          </p>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-6 text-sm sm:mt-0 sm:text-right">
          <div><p className="text-2xl font-semibold">{approvedReviews.length}</p><p className="text-white/70">Published</p></div>
          <div><p className="text-2xl font-semibold">{awaitingResponse}</p><p className="text-white/70">Awaiting reply</p></div>
        </div>
      </div>

      {reviews.length === 0 ? (
        <div className="mt-7 rounded-2xl border border-[var(--line)] bg-white p-6">
          <h2 className="text-lg font-semibold">No reviews yet</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            Reviews from completed stays at your properties will appear here after guests submit them.
          </p>
          {propertyIds.length === 0 && (
            <Link className="mt-5 inline-block text-sm font-semibold underline underline-offset-4" href="/host/properties">Add or review your properties</Link>
          )}
        </div>
      ) : (
        <div className="mt-7 space-y-4">
          {reviews.map((review) => {
            const property = one(review.properties);
            const booking = one(review.bookings);
            const guestName = booking?.contact_name?.trim() || "Verified guest";
            const moderation = moderationPresentation[review.moderation_status];

            return (
              <article className="rounded-2xl border border-[var(--line)] bg-white p-5 sm:p-7" key={review.id}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--sky)] font-semibold text-[var(--forest)]" aria-hidden="true">
                      {guestName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h2 className="font-semibold">{guestName}</h2>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        {property?.name ?? "Property unavailable"}
                        {booking ? ` · Stayed ${formatDate(booking.check_in)}–${formatDate(booking.check_out)}` : ` · Submitted ${formatDate(review.created_at)}`}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-[var(--terracotta)]" aria-label={`${review.rating} out of 5 stars`}>
                      <span aria-hidden="true">{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</span>
                    </p>
                    <span className={`mt-2 inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${moderation.className}`}>{moderation.label}</span>
                  </div>
                </div>

                {review.title && <h3 className="mt-5 font-semibold">{review.title}</h3>}
                <blockquote className="mt-3 border-l-2 border-[var(--gold)] pl-4 leading-7 text-[var(--ink)]">“{review.body}”</blockquote>

                {review.host_response ? (
                  <div className="mt-5 rounded-xl bg-[var(--sand)] p-4 text-sm leading-6">
                    <p className="font-semibold">Your response</p>
                    <p className="mt-1 text-[var(--muted)]">{review.host_response}</p>
                    {review.responded_at && <p className="mt-2 text-xs text-[var(--muted)]">Published {formatDate(review.responded_at)}</p>}
                  </div>
                ) : review.moderation_status === "approved" ? (
                  <HostResponseForm reviewId={review.id} guestName={guestName} />
                ) : (
                  <p className="mt-5 border-t border-[var(--line)] pt-5 text-sm text-[var(--muted)]">
                    {review.moderation_status === "pending"
                      ? "You can respond after this review is approved for publication."
                      : "This review was not published and cannot receive a public response."}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
