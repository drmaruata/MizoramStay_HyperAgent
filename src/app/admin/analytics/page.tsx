import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type FunnelStage = {
  stage: string;
  label: string;
  count: number;
};

type DestinationAnalytics = {
  destination: string;
  bookingCount: number;
  gmv: number;
  occupiedRoomNights: number;
  capacityRoomNights: number;
  occupancyPercent: number;
};

type VerificationCount = { status: string; count: number };

type AnalyticsReport = {
  period: { days: number; start: string; end: string; occupancyStart: string; occupancyEndExclusive: string };
  summary: { gmv: number; currencyCode: string; confirmedBookings: number; bookingConversionPercent: number; averageBookingValue: number };
  funnel: FunnelStage[];
  failures: { cancelledBookings: number; expiredBookings: number; failedPaymentAttempts: number; bookingsWithFailedPayment: number; paymentAttempts: number };
  occupancyByDestination: DestinationAnalytics[];
  verificationQueue: { open: number; byStatus: VerificationCount[] };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function parseReport(value: unknown): AnalyticsReport | null {
  if (!isRecord(value)) return null;
  const period = isRecord(value.period) ? value.period : null;
  const summary = isRecord(value.summary) ? value.summary : null;
  const failures = isRecord(value.failures) ? value.failures : null;
  const verificationQueue = isRecord(value.verificationQueue) ? value.verificationQueue : null;
  if (!period || !summary || !failures || !verificationQueue) return null;

  const funnel = Array.isArray(value.funnel) ? value.funnel.flatMap((item) => {
    if (!isRecord(item)) return [];
    const stage = stringValue(item.stage);
    const itemLabel = stringValue(item.label);
    return stage && itemLabel ? [{ stage, label: itemLabel, count: numberValue(item.count) }] : [];
  }) : [];

  const occupancyByDestination = Array.isArray(value.occupancyByDestination)
    ? value.occupancyByDestination.flatMap((item) => {
        if (!isRecord(item) || !stringValue(item.destination)) return [];
        return [{
          destination: stringValue(item.destination),
          bookingCount: numberValue(item.bookingCount),
          gmv: numberValue(item.gmv),
          occupiedRoomNights: numberValue(item.occupiedRoomNights),
          capacityRoomNights: numberValue(item.capacityRoomNights),
          occupancyPercent: numberValue(item.occupancyPercent),
        }];
      })
    : [];

  const byStatus = Array.isArray(verificationQueue.byStatus)
    ? verificationQueue.byStatus.flatMap((item) => {
        if (!isRecord(item) || !stringValue(item.status)) return [];
        return [{ status: stringValue(item.status), count: numberValue(item.count) }];
      })
    : [];

  return {
    period: {
      days: numberValue(period.days),
      start: stringValue(period.start),
      end: stringValue(period.end),
      occupancyStart: stringValue(period.occupancyStart),
      occupancyEndExclusive: stringValue(period.occupancyEndExclusive),
    },
    summary: {
      gmv: numberValue(summary.gmv),
      currencyCode: stringValue(summary.currencyCode, "INR"),
      confirmedBookings: numberValue(summary.confirmedBookings),
      bookingConversionPercent: numberValue(summary.bookingConversionPercent),
      averageBookingValue: numberValue(summary.averageBookingValue),
    },
    funnel,
    failures: {
      cancelledBookings: numberValue(failures.cancelledBookings),
      expiredBookings: numberValue(failures.expiredBookings),
      failedPaymentAttempts: numberValue(failures.failedPaymentAttempts),
      bookingsWithFailedPayment: numberValue(failures.bookingsWithFailedPayment),
      paymentAttempts: numberValue(failures.paymentAttempts),
    },
    occupancyByDestination,
    verificationQueue: { open: numberValue(verificationQueue.open), byStatus },
  };
}

function formatMoney(value: number, currencyCode: string) {
  if (currencyCode === "MIXED") return `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value)} mixed currency`;
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: currencyCode || "INR", maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currencyCode || "INR"} ${value.toFixed(2)}`;
  }
}

function formatDate(value: string) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(date);
}

function label(value: string) {
  return value.replaceAll("_", " ");
}

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect(`/login?next=${encodeURIComponent("/admin/analytics")}`);

  const { data: adminProfile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (profileError) throw new Error("Unable to verify administrator access.");
  if (!adminProfile) redirect("/");

  const { data, error } = await supabase.rpc("get_marketplace_analytics", { p_days: 30 });
  const report = error ? null : parseReport(data);
  const reportUnavailable = Boolean(error || !report);
  const funnelStart = report?.funnel[0]?.count ?? 0;
  const isZeroState = report !== null
    && funnelStart === 0
    && report.summary.gmv === 0
    && report.verificationQueue.open === 0
    && report.occupancyByDestination.length === 0;

  return <main className="min-h-screen bg-[var(--paper)]">
    <header className="border-b border-[var(--line)] bg-white"><div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4"><Link className="brand-mark font-bold" href="/">mizoram<span>stay</span></Link><span className="rounded-full bg-[var(--deep)] px-3 py-1 text-sm font-semibold text-white">Administrator analytics</span></div></header>
    <section className="mx-auto max-w-7xl px-5 py-10">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow">Marketplace analytics</p><h1 className="mt-2 text-4xl font-semibold">Booking performance</h1><p className="mt-2 max-w-3xl text-[var(--muted)]">Live aggregate booking, payment, occupancy, and marketplace review signals. No guest or host identity data is included.</p></div><span className="self-start rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold sm:self-auto">Trailing 30 days</span></div>

      {reportUnavailable ? <section className="mt-8 rounded-2xl border border-red-200 bg-white p-7" role="alert"><h2 className="text-xl font-semibold text-red-900">Analytics unavailable</h2><p className="mt-2 text-sm leading-6 text-[var(--muted)]">Live aggregate records could not be loaded. No fallback or preview figures are being shown. Refresh the page to try again.</p></section> : report && <>
        <p className="mt-6 text-sm text-[var(--muted)]">Reporting window: {formatDate(report.period.start)} to {formatDate(report.period.end)} IST.</p>
        {isZeroState && <section className="mt-6 rounded-2xl border border-dashed border-[var(--line)] bg-white p-6"><h2 className="text-xl font-semibold">No marketplace activity yet</h2><p className="mt-2 text-sm text-[var(--muted)]">The live tables contain no booking, occupancy, or open review activity for this report.</p></section>}

        <div className="mt-8 grid gap-4 md:grid-cols-4">{[
          [formatMoney(report.summary.gmv, report.summary.currencyCode), "Gross booking value"],
          [new Intl.NumberFormat("en-IN").format(report.summary.confirmedBookings), "Currently confirmed / completed"],
          [`${report.summary.bookingConversionPercent.toFixed(2)}%`, "Booking-start conversion"],
          [formatMoney(report.summary.averageBookingValue, report.summary.currencyCode), "Average confirmed booking"],
        ].map(([value, heading]) => <article key={heading} className="rounded-2xl border border-[var(--line)] bg-white p-5"><p className="text-3xl font-semibold">{value}</p><p className="mt-1 text-sm text-[var(--muted)]">{heading}</p></article>)}</div>

        <div className="mt-8 grid gap-5 lg:grid-cols-[1.25fr_.75fr]">
          <section className="rounded-2xl border border-[var(--line)] bg-white p-6" aria-labelledby="funnel-heading"><h2 id="funnel-heading" className="text-xl font-semibold">Transactional funnel</h2><p className="mt-1 text-sm leading-6 text-[var(--muted)]">Bookings created in the reporting window, followed through durable payment and current booking states. Search and page-view events are not inferred because they are not recorded in the marketplace schema.</p>
            {report.funnel.length === 0 ? <p className="mt-6 rounded-xl bg-[var(--sand)] p-4 text-sm text-[var(--muted)]">No funnel stages were returned.</p> : <ol className="mt-7 space-y-5">{report.funnel.map((stage, index) => {
              const percent = funnelStart === 0 ? 0 : Math.min(100, (stage.count / funnelStart) * 100);
              return <li key={stage.stage}><div className="flex items-baseline justify-between gap-4"><div><span className="mr-3 text-sm text-[var(--muted)]">{String(index + 1).padStart(2, "0")}</span><span className="font-semibold">{stage.label}</span></div><p className="shrink-0"><span className="font-semibold">{new Intl.NumberFormat("en-IN").format(stage.count)}</span><span className="ml-2 text-sm text-[var(--muted)]">{percent.toFixed(1)}%</span></p></div><div className="mt-2 h-3 overflow-hidden rounded-full bg-[var(--sand)]" aria-hidden="true"><div className="h-full rounded-full bg-[var(--forest)]" style={{ width: `${percent}%` }} /></div></li>;
            })}</ol>}
          </section>

          <section className="rounded-2xl border border-[var(--line)] bg-white p-6" aria-labelledby="failures-heading"><h2 id="failures-heading" className="text-xl font-semibold">Booking &amp; payment failures</h2><p className="mt-1 text-sm text-[var(--muted)]">Durable failure states recorded in the period.</p><dl className="mt-6 divide-y divide-[var(--line)]">{[
            [report.failures.expiredBookings, "Expired booking holds"],
            [report.failures.cancelledBookings, "Cancelled bookings"],
            [report.failures.failedPaymentAttempts, "Failed payment attempts"],
            [report.failures.bookingsWithFailedPayment, "Bookings affected by payment failure"],
          ].map(([count, heading]) => <div key={heading} className="flex items-center justify-between gap-4 py-4 first:pt-0"><dt className="text-sm text-[var(--muted)]">{heading}</dt><dd className="text-xl font-semibold">{new Intl.NumberFormat("en-IN").format(Number(count))}</dd></div>)}</dl><p className="mt-4 rounded-xl bg-[var(--sand)] p-3 text-xs leading-5 text-[var(--muted)]">{new Intl.NumberFormat("en-IN").format(report.failures.paymentAttempts)} total payment attempt{report.failures.paymentAttempts === 1 ? "" : "s"} recorded in this window.</p></section>
        </div>

        <section className="mt-8 overflow-hidden rounded-2xl border border-[var(--line)] bg-white" aria-labelledby="destination-heading"><div className="border-b border-[var(--line)] px-6 py-5"><h2 id="destination-heading" className="text-xl font-semibold">Occupancy by destination</h2><p className="mt-1 text-sm leading-6 text-[var(--muted)]">Occupied confirmed/completed room nights divided by reconstructed room-night capacity for past inventory dates in the 30-day window.</p></div>
          {report.occupancyByDestination.length === 0 ? <p className="p-6 text-sm text-[var(--muted)]">No destination inventory or booking activity is available for this period.</p> : <div className="overflow-x-auto"><table className="w-full min-w-200 text-left text-sm"><thead className="bg-[var(--sand)] text-[var(--muted)]"><tr>{["Destination", "Bookings started", "Confirmed GMV", "Occupied room nights", "Capacity room nights", "Occupancy"].map((heading) => <th key={heading} className="px-5 py-3 font-semibold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-[var(--line)]">{report.occupancyByDestination.map((destination) => <tr key={destination.destination}><td className="px-5 py-4 font-semibold">{destination.destination}</td><td className="px-5 py-4">{new Intl.NumberFormat("en-IN").format(destination.bookingCount)}</td><td className="px-5 py-4">{formatMoney(destination.gmv, report.summary.currencyCode)}</td><td className="px-5 py-4">{new Intl.NumberFormat("en-IN").format(destination.occupiedRoomNights)}</td><td className="px-5 py-4">{new Intl.NumberFormat("en-IN").format(destination.capacityRoomNights)}</td><td className="px-5 py-4 font-semibold">{destination.capacityRoomNights === 0 ? "Not measurable" : `${destination.occupancyPercent.toFixed(2)}%`}</td></tr>)}</tbody></table></div>}
        </section>

        <section className="mt-8 rounded-2xl border border-[var(--line)] bg-white p-6" aria-labelledby="verification-heading"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 id="verification-heading" className="text-xl font-semibold">Marketplace review queue</h2><p className="mt-1 text-sm text-[var(--muted)]">Current queue counts; these are a live snapshot rather than period-filtered activity.</p></div><Link className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-semibold" href="/admin/verification">Open review queue</Link></div><p className="mt-6 text-3xl font-semibold">{new Intl.NumberFormat("en-IN").format(report.verificationQueue.open)} <span className="text-base font-normal text-[var(--muted)]">open request{report.verificationQueue.open === 1 ? "" : "s"}</span></p>
          {report.verificationQueue.byStatus.length === 0 ? <p className="mt-5 text-sm text-[var(--muted)]">No verification status counts were returned.</p> : <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{report.verificationQueue.byStatus.map((item) => <article className="rounded-xl bg-[var(--sand)] p-4" key={item.status}><p className="text-2xl font-semibold">{new Intl.NumberFormat("en-IN").format(item.count)}</p><p className="mt-1 text-sm capitalize text-[var(--muted)]">{label(item.status)}</p></article>)}</div>}
        </section>
      </>}
    </section>
  </main>;
}
