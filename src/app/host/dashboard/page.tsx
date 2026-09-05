import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const stats = [["Upcoming guests", "8", "Across 3 reservations"], ["This month", "₹42,600", "Gross booking value"], ["To do", "3", "Finish listing tasks"]];

export default async function HostDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/host/dashboard")}`);

  return <main className="min-h-screen bg-[var(--paper)]"><header className="flex items-center justify-between border-b border-[var(--line)] bg-white px-5 py-4"><Link className="brand-mark font-bold" href="/">mizoram<span>stay</span></Link><span className="rounded-full bg-[var(--sand)] px-3 py-1 text-sm">Host preview</span></header><div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 lg:grid-cols-[220px_1fr]"><nav className="flex gap-4 overflow-auto lg:flex-col"><a className="font-semibold text-[var(--leaf)]" href="#overview">Overview</a><a href="#calendar">Calendar</a><a href="#bookings">Bookings</a><a href="#property">Property</a><a href="#reviews">Reviews</a></nav><section id="overview"><p className="eyebrow">Host workspace</p><h1 className="mt-3 text-4xl font-semibold">Good afternoon.</h1><p className="mt-2 text-[var(--muted)]">Here is what needs your attention today.</p><div className="mt-8 grid gap-4 md:grid-cols-3">{stats.map(([label, value, detail]) => <article className="rounded-2xl border border-[var(--line)] bg-white p-5" key={label}><p className="text-sm text-[var(--muted)]">{label}</p><p className="mt-3 text-3xl font-semibold">{value}</p><p className="mt-2 text-sm text-[var(--muted)]">{detail}</p></article>)}</div><section id="calendar" className="mt-8 rounded-2xl border border-[var(--line)] bg-white p-6"><div className="flex items-center justify-between"><h2 className="text-xl font-semibold">Availability calendar</h2><button className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-semibold">Block dates</button></div><div className="mt-6 grid grid-cols-7 gap-2 text-center text-sm">{Array.from({ length: 28 }, (_, index) => <div className={`rounded-lg p-3 ${index === 8 || index === 9 || index === 16 ? "bg-[var(--terracotta)] text-white" : index === 12 ? "bg-[var(--gold)]" : "bg-[var(--sand)]"}`} key={index}>{index + 1}</div>)}</div><p className="mt-4 text-sm text-[var(--muted)]">Booked dates are red, pending dates are gold. This preview is not connected to live inventory.</p></section></section></div></main>;
}
