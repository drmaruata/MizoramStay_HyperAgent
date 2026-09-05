import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BookingCheckout } from "@/components/booking/booking-checkout";
import { CancelBookingForm } from "@/components/booking/cancel-booking-form";
import { ReviewForm } from "@/components/reviews/review-form";
import { createClient } from "@/lib/supabase/server";
import { bookingIdSchema } from "@/lib/validation/phase3-booking";

type Props = { params: Promise<{ id: string }> };

type Destination = { name: string; state: string };
type Property = {
  id: string;
  name: string;
  slug: string;
  locality: string | null;
  check_in_time: string;
  check_out_time: string;
  destinations: Destination | Destination[] | null;
};
type Room = { id: string; name: string; beds_description: string | null };
type BookingItem = {
  id: string;
  quantity: number;
  nightly_rate: number | string;
  nights: number;
  line_total: number | string;
  rooms: Room | Room[] | null;
};
type Payment = {
  id: string;
  provider: string;
  status: string;
  amount: number | string;
  currency_code: string;
  paid_at: string | null;
  created_at: string;
};
type CancellationRequest = {
  id: string;
  status: string;
  policy_code: string;
  reason: string;
  refundable_amount: number | string;
  currency_code: string;
  completed_at: string | null;
  created_at: string;
};
type Refund = {
  id: string;
  provider: string;
  status: string;
  amount: number | string;
  currency_code: string;
  requested_at: string;
  completed_at: string | null;
  created_at: string;
};
type Review = {
  id: string;
  moderation_status: "pending" | "approved" | "rejected";
  is_published: boolean;
  host_response: string | null;
  responded_at: string | null;
  created_at: string;
};
type Booking = {
  id: string;
  status: "hold" | "confirmed" | "cancelled" | "expired" | "completed";
  check_in: string;
  check_out: string;
  guest_count: number;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  currency_code: string;
  subtotal: number | string;
  taxes: number | string;
  total_amount: number | string;
  hold_expires_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  properties: Property | Property[] | null;
  booking_items: BookingItem[];
  payments: Payment[];
  cancellation_requests: CancellationRequest[];
  refunds: Refund[];
  reviews: Review | Review[] | null;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Booking details",
  description: "Review your MizoramStay reservation, payment status, and cancellation terms.",
};

const bookingSelection = `
  id,
  status,
  check_in,
  check_out,
  guest_count,
  contact_name,
  contact_email,
  contact_phone,
  currency_code,
  subtotal,
  taxes,
  total_amount,
  hold_expires_at,
  cancelled_at,
  cancellation_reason,
  created_at,
  properties:property_id (
    id,
    name,
    slug,
    locality,
    check_in_time,
    check_out_time,
    destinations:destination_id (name, state)
  ),
  booking_items (
    id,
    quantity,
    nightly_rate,
    nights,
    line_total,
    rooms:room_id (id, name, beds_description)
  ),
  payments (
    id,
    provider,
    status,
    amount,
    currency_code,
    paid_at,
    created_at
  ),
  cancellation_requests (
    id,
    status,
    policy_code,
    reason,
    refundable_amount,
    currency_code,
    completed_at,
    created_at
  ),
  refunds (
    id,
    provider,
    status,
    amount,
    currency_code,
    requested_at,
    completed_at,
    created_at
  ),
  reviews (
    id,
    moderation_status,
    is_published,
    host_response,
    responded_at,
    created_at
  )
`;

function one<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function formatMoney(value: number | string, currencyCode: string) {
  const amount = Number(value);
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currencyCode} ${Number.isFinite(amount) ? amount.toLocaleString("en-IN") : value}`;
  }
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function formatTime(time: string) {
  const [hour = "0", minute = "0"] = time.split(":");
  const date = new Date(Date.UTC(2020, 0, 1, Number(hour), Number(minute)));
  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

const reviewStatusPresentation: Record<Review["moderation_status"], { label: string; className: string; explanation: string }> = {
  pending: {
    label: "Awaiting moderation",
    className: "bg-[var(--gold)] text-[var(--deep)]",
    explanation: "Your review is private while the moderation team checks it.",
  },
  approved: {
    label: "Published",
    className: "bg-emerald-100 text-emerald-900",
    explanation: "Your review has been approved and published.",
  },
  rejected: {
    label: "Not published",
    className: "bg-red-50 text-red-800",
    explanation: "Your review was not approved for publication.",
  },
};

const statusPresentation: Record<Booking["status"], { label: string; className: string; explanation: string }> = {
  hold: {
    label: "Held for payment",
    className: "bg-[var(--gold)] text-[var(--deep)]",
    explanation: "Your dates are temporarily reserved while payment is completed.",
  },
  confirmed: {
    label: "Confirmed",
    className: "bg-[var(--sky)] text-[var(--deep)]",
    explanation: "Payment is confirmed and your reservation is secured.",
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-red-50 text-red-800",
    explanation: "This reservation has been cancelled and cannot be used for check-in.",
  },
  expired: {
    label: "Hold expired",
    className: "bg-[var(--sand)] text-[var(--muted)]",
    explanation: "The payment window ended before confirmation and the dates were released.",
  },
  completed: {
    label: "Stay completed",
    className: "bg-[var(--sand)] text-[var(--deep)]",
    explanation: "This stay is complete.",
  },
};

export default async function BookingPage({ params }: Props) {
  const { id } = await params;
  const parsedId = bookingIdSchema.safeParse(id);
  if (!parsedId.success) notFound();

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    redirect(`/login?next=${encodeURIComponent(`/booking/${parsedId.data}`)}`);
  }

  // Use the user's publishable-key client so RLS remains authoritative for this read.
  const { data, error } = await supabase
    .from("bookings")
    .select(bookingSelection)
    .eq("id", parsedId.data)
    .eq("guest_id", user.id)
    .maybeSingle();

  if (error) throw new Error("Booking details are temporarily unavailable.");
  if (!data) notFound();

  const booking = data as unknown as Booking;
  const property = one(booking.properties);
  if (!property) throw new Error("This booking is missing its property details.");
  const destination = one(property.destinations);
  const status = statusPresentation[booking.status];
  const subtotal = Number(booking.subtotal);
  const taxes = Number(booking.taxes);
  const total = Number(booking.total_amount);
  const otherFees = Math.max(0, total - subtotal - taxes);
  // Exact expiry is handled by the live client countdown and enforced again by the
  // order/cancellation transaction; the database status remains the server truth here.
  const activeHold = booking.status === "hold" && Boolean(booking.hold_expires_at);
  const latestPayment = [...booking.payments].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const latestCancellation = [...booking.cancellation_requests].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const latestRefund = [...booking.refunds].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const review = one(booking.reviews);
  const reviewStatus = review ? reviewStatusPresentation[review.moderation_status] : null;
  const isReviewEligible = booking.status === "completed" && booking.check_out <= new Date().toISOString().slice(0, 10);
  const canCancel = activeHold || booking.status === "confirmed";

  return (
    <main className="min-h-screen bg-[var(--paper)]">
      <header className="border-b border-[var(--line)] bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
          <Link className="brand-mark text-xl font-bold" href="/">mizoram<span>stay</span></Link>
          <nav className="flex items-center gap-4 text-sm font-semibold" aria-label="Booking navigation">
            <Link className="underline underline-offset-4" href="/support">Support</Link>
            <Link className="underline underline-offset-4" href="/account">My trips</Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-5 pb-20 pt-8 sm:px-8 sm:pt-12">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
          <div>
            <p className="eyebrow">Booking {booking.id.slice(0, 8).toUpperCase()}</p>
            <h1 className="serif mt-3 text-4xl leading-tight sm:text-5xl">{property.name}</h1>
            <p className="mt-3 text-[var(--muted)]">
              {[property.locality, destination?.name, destination?.state].filter(Boolean).join(", ")}
            </p>
          </div>
          <div className="sm:max-w-xs sm:text-right">
            <span className={`inline-block rounded-full px-3 py-1.5 text-sm font-semibold ${status.className}`}>{status.label}</span>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{status.explanation}</p>
          </div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.25fr_.75fr]">
          <div className="space-y-6">
            <section className="rounded-2xl border border-[var(--line)] bg-white p-5 sm:p-7" aria-labelledby="stay-heading">
              <p className="eyebrow">Your stay</p>
              <h2 className="mt-2 text-2xl font-semibold" id="stay-heading">Dates and guests</h2>
              <dl className="mt-6 grid gap-5 sm:grid-cols-3">
                <div className="rounded-xl bg-[var(--sand)] p-4">
                  <dt className="text-xs font-bold uppercase tracking-[.12em] text-[var(--muted)]">Check-in</dt>
                  <dd className="mt-2 font-semibold">{formatDate(booking.check_in)}</dd>
                  <dd className="mt-1 text-sm text-[var(--muted)]">After {formatTime(property.check_in_time)}</dd>
                </div>
                <div className="rounded-xl bg-[var(--sand)] p-4">
                  <dt className="text-xs font-bold uppercase tracking-[.12em] text-[var(--muted)]">Check-out</dt>
                  <dd className="mt-2 font-semibold">{formatDate(booking.check_out)}</dd>
                  <dd className="mt-1 text-sm text-[var(--muted)]">By {formatTime(property.check_out_time)}</dd>
                </div>
                <div className="rounded-xl bg-[var(--sand)] p-4">
                  <dt className="text-xs font-bold uppercase tracking-[.12em] text-[var(--muted)]">Guests</dt>
                  <dd className="mt-2 font-semibold">{booking.guest_count} {booking.guest_count === 1 ? "guest" : "guests"}</dd>
                  <dd className="mt-1 text-sm text-[var(--muted)]">{booking.booking_items.reduce((sum, item) => sum + item.quantity, 0)} {booking.booking_items.reduce((sum, item) => sum + item.quantity, 0) === 1 ? "room" : "rooms"}</dd>
                </div>
              </dl>
              {booking.booking_items.length > 0 && (
                <div className="mt-6 border-t border-[var(--line)] pt-5">
                  <h3 className="text-sm font-semibold">Room selection</h3>
                  <ul className="mt-3 space-y-3">
                    {booking.booking_items.map((item) => {
                      const room = one(item.rooms);
                      return (
                        <li className="flex flex-wrap justify-between gap-2 text-sm" key={item.id}>
                          <span>{room?.name ?? "Room"}{room?.beds_description ? ` · ${room.beds_description}` : ""}</span>
                          <span className="text-[var(--muted)]">{item.nights} {item.nights === 1 ? "night" : "nights"} · {item.quantity} {item.quantity === 1 ? "room" : "rooms"}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </section>

            {activeHold && booking.hold_expires_at && (
              <BookingCheckout
                bookingId={booking.id}
                holdExpiresAt={booking.hold_expires_at}
                amount={total}
                currencyCode={booking.currency_code}
                contact={{ name: booking.contact_name, email: booking.contact_email, phone: booking.contact_phone }}
                propertyName={property.name}
              />
            )}

            {isReviewEligible && !review && <ReviewForm bookingId={booking.id} propertyName={property.name} />}

            {review && reviewStatus && (
              <section className="rounded-2xl border border-[var(--line)] bg-white p-5 sm:p-7" aria-labelledby="review-status-heading">
                <p className="eyebrow">Your review</p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-2xl font-semibold" id="review-status-heading">Review status</h2>
                  <span className={`rounded-full px-3 py-1.5 text-sm font-semibold ${reviewStatus.className}`}>{reviewStatus.label}</span>
                </div>
                <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{reviewStatus.explanation}</p>
                {review.host_response ? (
                  <div className="mt-5 rounded-xl bg-[var(--sand)] p-4 text-sm leading-6">
                    <p className="font-semibold">Host response</p>
                    <p className="mt-1 text-[var(--muted)]">{review.host_response}</p>
                    {review.responded_at && <p className="mt-2 text-xs text-[var(--muted)]">Responded {formatDate(review.responded_at.slice(0, 10))}</p>}
                  </div>
                ) : (
                  <p className="mt-5 rounded-xl bg-[var(--sand)] p-4 text-sm text-[var(--muted)]">
                    {review.moderation_status === "approved"
                      ? "The host has not responded to your review yet."
                      : review.moderation_status === "pending"
                        ? "A host response can be added after your review is approved."
                        : "Host responses are unavailable for reviews that are not published."}
                  </p>
                )}
                <Link className="mt-5 inline-block text-sm font-semibold text-[var(--forest)] underline underline-offset-4" href="/support">Questions about your review? Contact Support</Link>
              </section>
            )}

            <section className="rounded-2xl border border-[var(--line)] bg-white p-5 sm:p-7" aria-labelledby="cancellation-heading">
              <p className="eyebrow">Plans changed?</p>
              <h2 className="mt-2 text-2xl font-semibold" id="cancellation-heading">Cancellation terms</h2>
              <div className="mt-4 space-y-3 text-sm leading-6 text-[var(--muted)]">
                <p><strong className="text-[var(--ink)]">Booking hold:</strong> cancelling an active, unpaid hold releases the room immediately and there is no charge.</p>
                <p><strong className="text-[var(--ink)]">Confirmed booking:</strong> a guest may cancel before the check-in date for a full refund of captured payments. The cancellation is final and the room is released immediately.</p>
                <p>Refunds are requested to the original payment method when you cancel. Razorpay or your bank may need additional processing time. On or after check-in, contact support because online guest cancellation is unavailable.</p>
                <p>If payment was just submitted, wait for the verified payment status before cancelling so the final refund amount can be calculated correctly.</p>
              </div>
              {canCancel ? (
                <CancelBookingForm bookingId={booking.id} bookingStatus={booking.status as "hold" | "confirmed"} />
              ) : (
                <p className="mt-5 rounded-xl bg-[var(--sand)] p-3 text-sm text-[var(--muted)]">
                  {booking.status === "cancelled"
                    ? "This booking is already cancelled."
                    : booking.status === "expired" || (booking.status === "hold" && !activeHold)
                      ? "This hold has expired, so no cancellation action is needed."
                      : "This booking can no longer be cancelled online."}
                </p>
              )}
            </section>
          </div>

          <aside className="space-y-6 lg:sticky lg:top-6 lg:h-fit">
            <section className="rounded-2xl border border-[var(--line)] bg-[var(--sand)] p-5 sm:p-6" aria-labelledby="price-heading">
              <h2 className="text-xl font-semibold" id="price-heading">Transparent price summary</h2>
              <dl className="mt-5 space-y-3 text-sm">
                {booking.booking_items.map((item) => {
                  const room = one(item.rooms);
                  return (
                    <div className="flex justify-between gap-4" key={item.id}>
                      <dt>{room?.name ?? "Stay"} · {item.nights} {item.nights === 1 ? "night" : "nights"} × {item.quantity}</dt>
                      <dd className="shrink-0">{formatMoney(item.line_total, booking.currency_code)}</dd>
                    </div>
                  );
                })}
                <div className="flex justify-between gap-4 border-t border-[var(--line)] pt-3">
                  <dt>Accommodation subtotal</dt>
                  <dd>{formatMoney(booking.subtotal, booking.currency_code)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Taxes</dt>
                  <dd>{formatMoney(booking.taxes, booking.currency_code)}</dd>
                </div>
                {otherFees > 0.009 && (
                  <div className="flex justify-between gap-4">
                    <dt>Other fees</dt>
                    <dd>{formatMoney(otherFees, booking.currency_code)}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-4 border-t border-[var(--line)] pt-4 text-base font-bold">
                  <dt>{booking.status === "confirmed" || booking.status === "completed" ? "Total paid" : "Total"}</dt>
                  <dd>{formatMoney(booking.total_amount, booking.currency_code)}</dd>
                </div>
              </dl>
              <p className="mt-4 text-xs leading-5 text-[var(--muted)]">All amounts are shown in {booking.currency_code}. The total above is the amount recorded on your booking.</p>
            </section>

            <section className="rounded-2xl border border-[var(--line)] bg-white p-5 sm:p-6" aria-labelledby="payment-status-heading">
              <h2 className="text-xl font-semibold" id="payment-status-heading">Payment status</h2>
              {latestPayment ? (
                <dl className="mt-4 space-y-3 text-sm">
                  <div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">Provider</dt><dd className="font-semibold capitalize">{latestPayment.provider}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">Status</dt><dd className="font-semibold capitalize">{latestPayment.status.replaceAll("_", " ")}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">Amount</dt><dd className="font-semibold">{formatMoney(latestPayment.amount, latestPayment.currency_code)}</dd></div>
                </dl>
              ) : (
                <p className="mt-3 text-sm leading-6 text-[var(--muted)]">No payment has been recorded for this booking.</p>
              )}
              {latestPayment?.status === "pending" && <p className="mt-4 rounded-xl bg-[var(--sky)] p-3 text-sm leading-6">Pending means Razorpay has not yet been confirmed by the signed webhook. Do not make a second payment while confirmation is in progress.</p>}
            </section>

            {latestCancellation && (
              <section className="rounded-2xl border border-[var(--line)] bg-white p-5 sm:p-6" aria-labelledby="cancellation-status-heading">
                <h2 className="text-xl font-semibold" id="cancellation-status-heading">Cancellation status</h2>
                <dl className="mt-4 space-y-3 text-sm">
                  <div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">Status</dt><dd className="font-semibold capitalize">{latestCancellation.status}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">Policy</dt><dd className="text-right font-semibold">{latestCancellation.policy_code.replaceAll("_", " ")}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">Refundable amount</dt><dd className="font-semibold">{formatMoney(latestCancellation.refundable_amount, latestCancellation.currency_code)}</dd></div>
                  {latestRefund && <div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">Refund</dt><dd className="text-right font-semibold capitalize">{latestRefund.status} · {formatMoney(latestRefund.amount, latestRefund.currency_code)}</dd></div>}
                </dl>
                <p className="mt-4 border-t border-[var(--line)] pt-4 text-sm leading-6 text-[var(--muted)]"><strong className="text-[var(--ink)]">Reason:</strong> {latestCancellation.reason}</p>
              </section>
            )}

            <section className="rounded-2xl border border-[var(--line)] bg-white p-5 sm:p-6" aria-labelledby="guest-heading">
              <h2 className="text-xl font-semibold" id="guest-heading">Guest details</h2>
              <p className="mt-4 font-semibold">{booking.contact_name}</p>
              <p className="mt-1 break-all text-sm text-[var(--muted)]">{booking.contact_email}</p>
              {booking.contact_phone && <p className="mt-1 text-sm text-[var(--muted)]">{booking.contact_phone}</p>}
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}
