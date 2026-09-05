import Link from "next/link";
import { redirect } from "next/navigation";
import { RealtimeRefresh } from "@/components/realtime/realtime-refresh";
import { createClient } from "@/lib/supabase/server";

type BookingRow = {
  id: string;
  property_id: string;
  status: string;
  check_in: string;
  check_out: string;
  guest_count: number;
  contact_name: string;
  currency_code: string;
  total_amount: number | string;
  hold_expires_at: string | null;
  inventory_released_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
};

type PropertyRow = { id: string; name: string };
type PaymentRow = { booking_id: string; status: string; amount: number | string; currency_code: string };
type RefundRow = { booking_id: string; status: string; amount: number | string };
type CancellationRow = { booking_id: string; status: string; refundable_amount: number | string };

function groupBy<T>(items: T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const itemKey = key(item);
    groups.set(itemKey, [...(groups.get(itemKey) ?? []), item]);
  }
  return groups;
}

function numberValue(value: number | string) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatMoney(value: number | string, currency = "INR") {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(numberValue(value));
  } catch {
    return `${currency} ${numberValue(value).toFixed(2)}`;
  }
}

function formatDate(value: string | null, includeTime = false) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    ...(includeTime ? { timeStyle: "short" as const } : {}),
    timeZone: "Asia/Kolkata",
  }).format(date);
}

function label(value: string) {
  return value.replaceAll("_", " ");
}

function statusClass(status: string) {
  if (["confirmed", "completed", "captured", "refunded"].includes(status)) return "bg-emerald-100 text-emerald-900";
  if (["failed", "cancelled", "expired"].includes(status)) return "bg-red-100 text-red-900";
  return "bg-[var(--sand)] text-[var(--deep)]";
}

function bookingException(booking: BookingRow, payments: PaymentRow[], refunds: RefundRow[], cancellations: CancellationRow[], now: number) {
  if (booking.status === "hold" && booking.hold_expires_at && new Date(booking.hold_expires_at).getTime() <= now) return "Expired hold is awaiting inventory release";
  if (booking.status === "confirmed" && !payments.some((payment) => ["captured", "partially_refunded", "refunded"].includes(payment.status))) return "Confirmed booking has no captured payment";
  if (booking.status === "cancelled" && !booking.inventory_released_at) return "Cancelled booking has no inventory release marker";
  if (booking.status === "cancelled" && !cancellations.some((request) => request.status === "completed")) return "Cancellation workflow record is missing";
  if (refunds.some((refund) => refund.status === "failed")) return "A related refund has failed";
  return null;
}

export default async function BookingsPage() {
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

  const [bookingsResult, propertiesResult, paymentsResult, refundsResult, cancellationsResult] = await Promise.all([
    supabase.from("bookings").select("id,property_id,status,check_in,check_out,guest_count,contact_name,currency_code,total_amount,hold_expires_at,inventory_released_at,cancelled_at,cancellation_reason,created_at").order("created_at", { ascending: false }).limit(200),
    supabase.from("properties").select("id,name").limit(1000),
    supabase.from("payments").select("booking_id,status,amount,currency_code").limit(1000),
    supabase.from("refunds").select("booking_id,status,amount").limit(1000),
    supabase.from("cancellation_requests").select("booking_id,status,refundable_amount").limit(1000),
  ]);

  const bookings = (bookingsResult.data ?? []) as BookingRow[];
  const properties = (propertiesResult.data ?? []) as PropertyRow[];
  const payments = (paymentsResult.data ?? []) as PaymentRow[];
  const refunds = (refundsResult.data ?? []) as RefundRow[];
  const cancellations = (cancellationsResult.data ?? []) as CancellationRow[];
  const propertyNames = new Map(properties.map((property) => [property.id, property.name]));
  const paymentsByBooking = groupBy(payments, (payment) => payment.booking_id);
  const refundsByBooking = groupBy(refunds, (refund) => refund.booking_id);
  const cancellationsByBooking = groupBy(cancellations, (request) => request.booking_id);
  const today = new Date();
  const renderedAt = today.getTime();
  const exceptions = bookings.flatMap((booking) => {
    const issue = bookingException(booking, paymentsByBooking.get(booking.id) ?? [], refundsByBooking.get(booking.id) ?? [], cancellationsByBooking.get(booking.id) ?? [], renderedAt);
    return issue ? [{ booking, issue }] : [];
  });
  const weekEnd = new Date(renderedAt + 7 * 24 * 60 * 60 * 1000);
  const arrivals = bookings.filter((booking) => {
    const checkIn = new Date(`${booking.check_in}T00:00:00+05:30`);
    return checkIn >= today && checkIn <= weekEnd && booking.status === "confirmed";
  }).length;
  const activeHolds = bookings.filter((booking) => booking.status === "hold" && Boolean(booking.hold_expires_at) && new Date(booking.hold_expires_at!).getTime() > renderedAt).length;
  const grossValue = bookings.reduce((total, booking) => total + numberValue(booking.total_amount), 0);
  const hasDataError = [bookingsResult.error, propertiesResult.error, paymentsResult.error, refundsResult.error, cancellationsResult.error].some(Boolean);

  return <main className="min-h-screen bg-[var(--paper)]">
    <RealtimeRefresh channelName="admin-bookings" subscriptions={[{ table: "bookings" }]} />
    <header className="border-b border-[var(--line)] bg-white"><div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4"><Link className="brand-mark font-bold" href="/">mizoram<span>stay</span></Link><span className="rounded-full bg-[var(--deep)] px-3 py-1 text-sm font-semibold text-white">Administrator operations</span></div></header>
    <section className="mx-auto max-w-7xl px-5 py-10">
      <p className="eyebrow">Booking oversight</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-4xl font-semibold">Reservation desk</h1><p className="mt-2 text-[var(--muted)]">Live reservation, payment, cancellation, and refund signals from the marketplace.</p></div><p className="text-sm text-[var(--muted)]">Showing {bookings.length} most recent booking{bookings.length === 1 ? "" : "s"}</p></div>
      {hasDataError && <p className="mt-6 rounded-xl border border-[var(--gold)] bg-[var(--sand)] px-4 py-3 text-sm text-[var(--terracotta)]" role="alert">Some operational records could not be loaded. Counts and cross-checks may be incomplete.</p>}
      <div className="mt-8 grid gap-4 md:grid-cols-4">{[[String(arrivals), "Confirmed arrivals, next 7 days"], [String(activeHolds), "Active booking holds"], [String(exceptions.length), "Operational exceptions"], [formatMoney(grossValue), "Value in loaded queue"]].map(([value, heading]) => <article key={heading} className="rounded-2xl border border-[var(--line)] bg-white p-5"><p className="text-3xl font-semibold">{value}</p><p className="mt-1 text-sm text-[var(--muted)]">{heading}</p></article>)}</div>

      <section className="mt-8 overflow-hidden rounded-2xl border border-[var(--line)] bg-white" aria-labelledby="booking-queue-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-6 py-5"><div><h2 id="booking-queue-heading" className="text-xl font-semibold">Booking queue</h2><p className="mt-1 text-sm text-[var(--muted)]">Newest reservations first. Amounts are booking totals; payment state is reconciled separately.</p></div><Link className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-semibold" href="/admin/payments">Open payment operations</Link></div>
        {bookings.length === 0 ? <p className="p-6 text-sm text-[var(--muted)]">No booking records are available.</p> : <div className="overflow-x-auto"><table className="w-full min-w-280 text-left text-sm"><thead className="bg-[var(--sand)] text-[var(--muted)]"><tr>{["Reference", "Stay / guest", "Dates", "Status", "Booking total", "Payment state", "Refund state", "Operational check"].map((heading) => <th key={heading} className="px-5 py-3 font-semibold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-[var(--line)]">{bookings.map((booking) => {
          const bookingPayments = paymentsByBooking.get(booking.id) ?? [];
          const bookingRefunds = refundsByBooking.get(booking.id) ?? [];
          const issue = bookingException(booking, bookingPayments, bookingRefunds, cancellationsByBooking.get(booking.id) ?? [], renderedAt);
          return <tr key={booking.id} className={issue ? "bg-red-50/50" : undefined}>
            <td className="px-5 py-4"><p className="font-mono text-xs font-semibold">{booking.id.slice(0, 8)}</p><p className="mt-1 text-xs text-[var(--muted)]">Created {formatDate(booking.created_at, true)} IST</p></td>
            <td className="px-5 py-4"><p className="font-semibold">{propertyNames.get(booking.property_id) ?? "Property unavailable"}</p><p className="mt-1 text-xs text-[var(--muted)]">{booking.contact_name} · {booking.guest_count} guest{booking.guest_count === 1 ? "" : "s"}</p></td>
            <td className="px-5 py-4 whitespace-nowrap">{formatDate(booking.check_in)} – {formatDate(booking.check_out)}</td>
            <td className="px-5 py-4"><span className={`rounded-full px-2 py-1 text-xs font-semibold capitalize ${statusClass(booking.status)}`}>{label(booking.status)}</span>{booking.cancelled_at && <p className="mt-2 text-xs text-[var(--muted)]">Cancelled {formatDate(booking.cancelled_at, true)} IST</p>}</td>
            <td className="px-5 py-4 font-semibold">{formatMoney(booking.total_amount, booking.currency_code)}</td>
            <td className="px-5 py-4">{bookingPayments.length ? <div className="space-y-1">{bookingPayments.map((payment, index) => <p key={`${payment.status}-${index}`}><span className={`rounded-full px-2 py-1 text-xs font-semibold capitalize ${statusClass(payment.status)}`}>{label(payment.status)}</span> <span className="text-xs text-[var(--muted)]">{formatMoney(payment.amount, payment.currency_code)}</span></p>)}</div> : <span className="text-[var(--muted)]">No payment</span>}</td>
            <td className="px-5 py-4">{bookingRefunds.length ? <div className="space-y-1">{bookingRefunds.map((refund, index) => <p key={`${refund.status}-${index}`}><span className={`rounded-full px-2 py-1 text-xs font-semibold capitalize ${statusClass(refund.status)}`}>{label(refund.status)}</span> <span className="text-xs text-[var(--muted)]">{formatMoney(refund.amount, booking.currency_code)}</span></p>)}</div> : <span className="text-[var(--muted)]">None</span>}</td>
            <td className="px-5 py-4">{issue ? <span className="font-semibold text-red-800">{issue}</span> : <span className="text-emerald-800">No exception detected</span>}</td>
          </tr>;
        })}</tbody></table></div>}
      </section>

      <section className="mt-8 rounded-2xl border border-[var(--line)] bg-white p-6" aria-labelledby="booking-exceptions-heading">
        <h2 id="booking-exceptions-heading" className="text-xl font-semibold">Operational exceptions</h2><p className="mt-1 text-sm text-[var(--muted)]">Cross-checks on booking lifecycle, payment capture, cancellation workflow, inventory release, and failed refunds.</p>
        {exceptions.length === 0 ? <p className="mt-5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">No exceptions detected in the loaded booking queue.</p> : <div className="mt-5 grid gap-3 md:grid-cols-2">{exceptions.map(({ booking, issue }) => <article className="rounded-xl border border-red-200 bg-red-50 p-4" key={`${booking.id}-${issue}`}><div className="flex items-start justify-between gap-3"><h3 className="font-semibold">{propertyNames.get(booking.property_id) ?? booking.id.slice(0, 8)}</h3><span className="font-mono text-xs">{booking.id.slice(0, 8)}</span></div><p className="mt-2 text-sm text-red-900">{issue}</p>{booking.cancellation_reason && <p className="mt-2 text-xs text-[var(--muted)]">Cancellation reason: {booking.cancellation_reason}</p>}</article>)}</div>}
      </section>
    </section>
  </main>;
}
