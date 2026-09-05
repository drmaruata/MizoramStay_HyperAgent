import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ReviewForm } from "@/components/reviews/review-form";
import { createClient } from "@/lib/supabase/server";

type PropertySummary = {
  name: string;
  locality: string | null;
  destinations: { name: string; state: string } | { name: string; state: string }[] | null;
};

type TravellerReview = {
  id: string;
  moderation_status: "pending" | "approved" | "rejected";
  is_published: boolean;
  host_response: string | null;
  responded_at: string | null;
  created_at: string;
};

type TravellerBooking = {
  id: string;
  status: "hold" | "confirmed" | "cancelled" | "expired" | "completed";
  check_in: string;
  check_out: string;
  guest_count: number;
  currency_code: string;
  total_amount: number | string;
  hold_expires_at: string | null;
  created_at: string;
  properties: PropertySummary | PropertySummary[] | null;
  reviews: TravellerReview | TravellerReview[] | null;
};

type Payment = {
  id: string;
  booking_id: string;
  status: string;
  amount: number | string;
  currency_code: string;
  paid_at: string | null;
  created_at: string;
};

type Refund = {
  id: string;
  booking_id: string;
  status: string;
  amount: number | string;
  currency_code: string;
  requested_at: string;
  created_at: string;
};

type QueryError = { code?: string; message?: string } | null;

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your account",
  description: "Manage your MizoramStay trips, payments, refunds, and travel preferences.",
};

const bookingStatus: Record<TravellerBooking["status"], { label: string; className: string }> = {
  hold: { label: "Payment pending", className: "bg-[var(--gold)] text-[var(--deep)]" },
  confirmed: { label: "Confirmed", className: "bg-emerald-100 text-emerald-900" },
  cancelled: { label: "Cancelled", className: "bg-red-50 text-red-800" },
  expired: { label: "Hold expired", className: "bg-[var(--sand)] text-[var(--muted)]" },
  completed: { label: "Completed", className: "bg-[var(--sky)] text-[var(--deep)]" },
};

const reviewStatus: Record<TravellerReview["moderation_status"], { label: string; className: string; detail: string }> = {
  pending: {
    label: "Awaiting moderation",
    className: "bg-[var(--gold)] text-[var(--deep)]",
    detail: "Your review remains private while it is checked.",
  },
  approved: {
    label: "Published",
    className: "bg-emerald-100 text-emerald-900",
    detail: "Your review is published.",
  },
  rejected: {
    label: "Not published",
    className: "bg-red-50 text-red-800",
    detail: "Your review was not approved for publication.",
  },
};

function one<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function groupByBooking<T extends { booking_id: string }>(items: T[]) {
  const grouped = new Map<string, T[]>();
  for (const item of items) grouped.set(item.booking_id, [...(grouped.get(item.booking_id) ?? []), item]);
  return grouped;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function formatMoney(value: number | string, currencyCode: string) {
  const amount = Number(value);
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(amount) ? amount : 0);
  } catch {
    return `${currencyCode} ${Number.isFinite(amount) ? amount.toLocaleString("en-IN") : value}`;
  }
}

function labelStatus(value: string) {
  return value.replaceAll("_", " ");
}

function statusClass(value: string) {
  if (["captured", "completed", "refunded"].includes(value)) return "bg-emerald-100 text-emerald-900";
  if (["failed", "cancelled", "expired"].includes(value)) return "bg-red-50 text-red-800";
  return "bg-[var(--sand)] text-[var(--deep)]";
}

function isMissingTable(error: QueryError) {
  return error?.code === "42P01" || error?.code === "PGRST205" || Boolean(error?.message?.toLowerCase().includes("could not find the table"));
}

export default async function AccountPage() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect(`/login?next=${encodeURIComponent("/account")}`);

  // Every query uses the authenticated publishable-key client. Explicit ownership filters
  // narrow traveller data further while database RLS remains the final authority.
  const [profileResult, bookingsResult, reviewsResult, wishlistResult] = await Promise.all([
    supabase.from("profiles").select("display_name,created_at").eq("id", user.id).maybeSingle(),
    supabase
      .from("bookings")
      .select(`
        id,
        status,
        check_in,
        check_out,
        guest_count,
        currency_code,
        total_amount,
        hold_expires_at,
        created_at,
        properties:property_id (
          name,
          locality,
          destinations:destination_id (name, state)
        ),
        reviews (
          id,
          moderation_status,
          is_published,
          host_response,
          responded_at,
          created_at
        )
      `)
      .eq("guest_id", user.id)
      .order("check_in", { ascending: false }),
    supabase.from("reviews").select("id", { count: "exact", head: true }).eq("guest_id", user.id),
    supabase.from("wishlists").select("id", { count: "exact", head: true }).eq("user_id", user.id),
  ]);

  const bookings = (bookingsResult.data ?? []) as unknown as TravellerBooking[];
  const bookingIds = bookings.map((booking) => booking.id);
  let payments: Payment[] = [];
  let refunds: Refund[] = [];
  let paymentsError: QueryError = null;
  let refundsError: QueryError = null;

  if (bookingIds.length > 0) {
    const [paymentsResult, refundsResult] = await Promise.all([
      supabase
        .from("payments")
        .select("id,booking_id,status,amount,currency_code,paid_at,created_at")
        .in("booking_id", bookingIds)
        .order("created_at", { ascending: false }),
      supabase
        .from("refunds")
        .select("id,booking_id,status,amount,currency_code,requested_at,created_at")
        .in("booking_id", bookingIds)
        .order("created_at", { ascending: false }),
    ]);
    payments = (paymentsResult.data ?? []) as Payment[];
    refunds = (refundsResult.data ?? []) as Refund[];
    paymentsError = paymentsResult.error;
    refundsError = refundsResult.error;
  }

  const profile = profileResult.data as { display_name: string; created_at: string } | null;
  const displayName = profile?.display_name?.trim() || user.user_metadata.display_name || user.email?.split("@")[0] || "Traveller";
  const initials = displayName.split(/\s+/).slice(0, 2).map((part: string) => part.charAt(0).toUpperCase()).join("") || "T";
  const memberYear = new Date(profile?.created_at ?? user.created_at).getFullYear();
  const paymentsByBooking = groupByBooking(payments);
  const refundsByBooking = groupByBooking(refunds);
  const today = new Date().toISOString().slice(0, 10);
  const upcomingTrips = bookings.filter((booking) => ["hold", "confirmed"].includes(booking.status) && booking.check_out >= today).length;
  const coreLoadError = Boolean(profileResult.error || bookingsResult.error || paymentsError || refundsError);
  const reviewsAvailable = !reviewsResult.error;
  const wishlistAvailable = !wishlistResult.error;
  const reviewsMissing = isMissingTable(reviewsResult.error);
  const wishlistMissing = isMissingTable(wishlistResult.error);

  return (
    <main className="min-h-screen bg-[var(--paper)]">
      <header className="border-b border-[var(--line)] bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-10">
          <Link className="brand-mark text-xl font-bold" href="/">mizoram<span>stay</span></Link>
          <nav className="flex items-center gap-4 text-sm font-semibold" aria-label="Account shortcuts">
            <Link href="/support" className="underline underline-offset-4">Support</Link>
            <Link href="/stays" className="underline underline-offset-4">Explore stays</Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-5 pb-20 pt-10 sm:px-8 lg:px-10">
        <p className="eyebrow">Traveller account</p>
        <h1 className="serif mt-3 text-5xl tracking-tight">Hello, {displayName}.</h1>
        <p className="mt-4 max-w-2xl leading-7 text-[var(--muted)]">Your reservations and money movements below come from your live account records.</p>

        {coreLoadError && (
          <p className="mt-6 rounded-xl border border-[var(--gold)] bg-[var(--sand)] px-4 py-3 text-sm text-[var(--terracotta)]" role="alert">
            Some account records could not be loaded. Refresh the page before relying on the summary below.
          </p>
        )}

        <div className="mt-10 grid gap-6 lg:grid-cols-[.7fr_1.3fr]">
          <aside className="h-fit rounded-3xl bg-[var(--deep)] p-7 text-white">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--gold)] text-xl font-bold text-[var(--deep)]">{initials}</div>
            <h2 className="mt-5 text-2xl font-semibold">{displayName}</h2>
            <p className="mt-1 break-all text-sm text-white/70">{user.email ?? "Signed-in traveller"}</p>
            <p className="mt-1 text-sm text-white/70">Member since {Number.isFinite(memberYear) ? memberYear : "—"}</p>
            <nav aria-label="Account navigation" className="mt-7 space-y-1 text-sm">
              <a className="block rounded-xl bg-white/10 px-4 py-3 font-semibold" href="#trips">My trips</a>
              <a className="block rounded-xl px-4 py-3 hover:bg-white/10" href="#payments">Payments and refunds</a>
              <Link className="block rounded-xl px-4 py-3 hover:bg-white/10" href="/travel-guides">Travel guides</Link>
              <Link className="block rounded-xl px-4 py-3 hover:bg-white/10" href="/support">Support</Link>
            </nav>
          </aside>

          <div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" id="payments">
              <article className="rounded-2xl border border-[var(--line)] bg-white p-5"><p className="text-3xl font-semibold">{upcomingTrips}</p><p className="mt-1 text-sm text-[var(--muted)]">Upcoming trips</p></article>
              <article className="rounded-2xl border border-[var(--line)] bg-white p-5"><p className="text-3xl font-semibold">{payments.length}</p><p className="mt-1 text-sm text-[var(--muted)]">Payment records</p></article>
              <article className="rounded-2xl border border-[var(--line)] bg-white p-5"><p className="text-3xl font-semibold">{refunds.length}</p><p className="mt-1 text-sm text-[var(--muted)]">Refund records</p></article>
              <article className="rounded-2xl border border-[var(--line)] bg-white p-5"><p className="text-3xl font-semibold">{wishlistAvailable ? wishlistResult.count ?? 0 : "—"}</p><p className="mt-1 text-sm text-[var(--muted)]">Saved stays</p></article>
            </div>

            <section className="mt-6" id="trips" aria-labelledby="trips-heading">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div><p className="eyebrow">Reservations</p><h2 id="trips-heading" className="mt-2 text-3xl font-semibold">My trips</h2></div>
                <p className="text-sm text-[var(--muted)]">{bookings.length} booking{bookings.length === 1 ? "" : "s"}</p>
              </div>

              {bookings.length === 0 ? (
                <div className="mt-4 rounded-2xl border border-[var(--line)] bg-white p-6">
                  <h3 className="text-lg font-semibold">No trips yet</h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted)]">When you reserve a stay, its live booking and payment status will appear here.</p>
                  <Link className="mt-5 inline-block rounded-full bg-[var(--deep)] px-5 py-3 text-sm font-semibold text-white" href="/stays">Find a stay</Link>
                </div>
              ) : (
                <div className="mt-4 space-y-4">
                  {bookings.map((booking) => {
                    const property = one(booking.properties);
                    const destination = one(property?.destinations);
                    const latestPayment = paymentsByBooking.get(booking.id)?.[0];
                    const latestRefund = refundsByBooking.get(booking.id)?.[0];
                    const review = one(booking.reviews);
                    const moderation = review ? reviewStatus[review.moderation_status] : null;
                    const isReviewEligible = booking.status === "completed" && booking.check_out <= today;
                    const location = [property?.locality, destination?.name, destination?.state].filter(Boolean).join(", ");
                    const status = bookingStatus[booking.status];

                    return (
                      <article className="rounded-2xl border border-[var(--line)] bg-white p-5 sm:p-6" key={booking.id}>
                        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2"><h3 className="text-xl font-semibold">{property?.name ?? "Property unavailable"}</h3><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status.className}`}>{status.label}</span></div>
                            <p className="mt-2 text-sm text-[var(--muted)]">{location || "Location unavailable"}</p>
                            <p className="mt-2 text-sm">{formatDate(booking.check_in)}–{formatDate(booking.check_out)} · {booking.guest_count} {booking.guest_count === 1 ? "guest" : "guests"}</p>
                            <p className="mt-1 font-mono text-xs text-[var(--muted)]">Booking {booking.id.slice(0, 8).toUpperCase()}</p>
                          </div>
                          <div className="sm:text-right">
                            <p className="font-semibold">{formatMoney(booking.total_amount, booking.currency_code)}</p>
                            {booking.status === "hold" && booking.hold_expires_at && <p className="mt-1 text-xs text-[var(--muted)]">Payment hold in progress</p>}
                            <Link className="mt-4 inline-block rounded-full border border-[var(--ink)] px-4 py-2 text-sm font-semibold" href={`/booking/${booking.id}`}>View booking</Link>
                          </div>
                        </div>
                        <dl className="mt-5 grid gap-3 border-t border-[var(--line)] pt-4 sm:grid-cols-2">
                          <div><dt className="text-xs font-bold uppercase tracking-[.12em] text-[var(--muted)]">Latest payment</dt><dd className="mt-2 text-sm">{latestPayment ? <><span className={`rounded-full px-2 py-1 text-xs font-semibold capitalize ${statusClass(latestPayment.status)}`}>{labelStatus(latestPayment.status)}</span> <span className="ml-1">{formatMoney(latestPayment.amount, latestPayment.currency_code)}</span></> : "No payment recorded"}</dd></div>
                          <div><dt className="text-xs font-bold uppercase tracking-[.12em] text-[var(--muted)]">Latest refund</dt><dd className="mt-2 text-sm">{latestRefund ? <><span className={`rounded-full px-2 py-1 text-xs font-semibold capitalize ${statusClass(latestRefund.status)}`}>{labelStatus(latestRefund.status)}</span> <span className="ml-1">{formatMoney(latestRefund.amount, latestRefund.currency_code)}</span></> : "No refund recorded"}</dd></div>
                        </dl>

                        {isReviewEligible && !review && (
                          <div className="mt-5 border-t border-[var(--line)] pt-5">
                            <ReviewForm bookingId={booking.id} propertyName={property?.name} />
                          </div>
                        )}

                        {review && moderation && (
                          <div className="mt-5 border-t border-[var(--line)] pt-5">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <p className="font-semibold">Your review</p>
                              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${moderation.className}`}>{moderation.label}</span>
                            </div>
                            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{moderation.detail}</p>
                            {review.host_response ? (
                              <div className="mt-3 rounded-xl bg-[var(--sand)] p-4 text-sm leading-6">
                                <p className="font-semibold">Host response</p>
                                <p className="mt-1 text-[var(--muted)]">{review.host_response}</p>
                                {review.responded_at && <p className="mt-2 text-xs text-[var(--muted)]">Responded {formatDate(review.responded_at.slice(0, 10))}</p>}
                              </div>
                            ) : (
                              <p className="mt-2 text-sm text-[var(--muted)]">
                                {review.moderation_status === "approved"
                                  ? "The host has not responded yet."
                                  : review.moderation_status === "pending"
                                    ? "A host response can be added after approval."
                                    : "Host responses are unavailable for reviews that are not published."}
                              </p>
                            )}
                            <Link className="mt-3 inline-block text-sm font-semibold text-[var(--forest)] underline underline-offset-4" href="/support">Review support</Link>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="mt-6 rounded-2xl border border-[var(--line)] bg-white p-6" aria-labelledby="preferences-heading">
              <p className="eyebrow">Travel activity</p><h2 id="preferences-heading" className="mt-2 text-2xl font-semibold">Saved stays and reviews</h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl bg-[var(--sand)] p-4"><p className="font-semibold">Wishlist</p><p className="mt-1 text-sm text-[var(--muted)]">{wishlistAvailable ? `${wishlistResult.count ?? 0} saved stay${wishlistResult.count === 1 ? "" : "s"}` : wishlistMissing ? "Wishlist is not available on this deployment." : "Wishlist could not be loaded right now."}</p></div>
                <div className="rounded-xl bg-[var(--sand)] p-4"><p className="font-semibold">Reviews</p><p className="mt-1 text-sm text-[var(--muted)]">{reviewsAvailable ? `${reviewsResult.count ?? 0} review${reviewsResult.count === 1 ? "" : "s"}` : reviewsMissing ? "Reviews are not available on this deployment." : "Reviews could not be loaded right now."}</p></div>
              </div>
            </section>
          </div>
        </div>

        <section className="mt-8 rounded-3xl border border-[var(--line)] bg-[var(--sand)] p-6 sm:flex sm:items-center sm:justify-between sm:p-8"><div><p className="eyebrow">Need a hand?</p><h2 className="mt-2 text-2xl font-semibold">Traveller support</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">For booking or payment questions, include the booking reference shown in your trip details.</p></div><Link className="mt-5 inline-block rounded-full bg-[var(--terracotta)] px-5 py-3 text-sm font-semibold text-white sm:mt-0" href="/support">Contact Support</Link></section>
      </section>
    </main>
  );
}
