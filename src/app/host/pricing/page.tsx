import Link from "next/link";
import { redirect } from "next/navigation";
import InventoryEditor from "@/components/host/inventory-editor";
import { createClient } from "@/lib/supabase/server";

const money = (amount: number | string, currency: string) => new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(amount));
const dateKey = (date: Date) => date.toISOString().slice(0, 10);

export default async function HostPricingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/host/pricing")}`);
  const { data: properties, error: propertiesError } = await supabase.from("properties").select("id").eq("host_id", user.id);
  const propertyIds = properties?.map((property) => property.id) ?? [];
  const { data: rooms, error: roomsError } = propertyIds.length ? await supabase.from("rooms").select("id,name,base_nightly_rate,currency_code").in("property_id", propertyIds).eq("is_active", true).order("created_at") : { data: [], error: null };
  const roomIds = rooms?.map((room) => room.id) ?? [];
  const today = new Date();
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
  const { data: inventory, error: inventoryError } = roomIds.length ? await supabase.from("nightly_inventory").select("room_id,stay_date,nightly_rate,currency_code,available_units").in("room_id", roomIds).gte("stay_date", dateKey(start)).lte("stay_date", dateKey(end)).order("stay_date") : { data: [], error: null };
  const room = rooms?.[0];
  const monthName = start.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

  return <main className="min-h-screen bg-[var(--paper)]"><header className="border-b border-[var(--line)] bg-white"><div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4"><Link href="/" className="brand-mark text-lg font-bold">mizoram<span>stay</span></Link><Link href="/host/dashboard" className="text-sm font-semibold">Host dashboard</Link></div></header><section className="mx-auto max-w-6xl px-5 py-9 sm:py-12"><p className="eyebrow">Rate management</p><h1 className="serif mt-2 text-4xl sm:text-5xl">Pricing</h1><p className="mt-3 text-[var(--muted)]">Live base rates and date-specific rates for your active rooms.</p>{propertiesError || roomsError || inventoryError ? <p className="mt-8 rounded-2xl bg-[var(--sand)] p-5 text-sm text-[var(--terracotta)]">Pricing is temporarily unavailable. Please refresh and try again.</p> : !room ? <section className="mt-8 rounded-2xl border border-dashed border-[var(--line)] bg-white p-8"><h2 className="text-xl font-semibold">No active rooms to price</h2><p className="mt-2 text-sm text-[var(--muted)]">Create and activate a room before adding nightly rates.</p><Link href="/host/rooms" className="mt-5 inline-flex rounded-full bg-[var(--terracotta)] px-5 py-3 text-sm font-semibold text-white">Manage rooms</Link></section> : <div className="mt-8 grid gap-6 lg:grid-cols-[.8fr_1.2fr]"><aside className="space-y-6"><section className="rounded-2xl border border-[var(--line)] bg-white p-6"><h2 className="text-xl font-semibold">Base nightly rates</h2><div className="mt-5 space-y-3">{rooms?.map((item) => <div key={item.id} className="rounded-xl bg-[var(--sand)] p-4"><p className="text-sm font-semibold">{item.name}</p><p className="mt-1 text-2xl font-semibold">{money(item.base_nightly_rate, item.currency_code)}<span className="text-sm font-normal text-[var(--muted)]"> / night</span></p></div>)}</div></section><InventoryEditor roomId={room.id} roomName={room.name} /></aside><section className="rounded-2xl border border-[var(--line)] bg-white p-6"><h2 className="text-xl font-semibold">{monthName} adjustments</h2><p className="mt-1 text-sm text-[var(--muted)]">Saved nightly inventory rates for {room.name}.</p>{inventory?.filter((item) => item.room_id === room.id).length ? <div className="mt-6 divide-y divide-[var(--line)]">{inventory.filter((item) => item.room_id === room.id).map((item) => <div className="flex items-center justify-between gap-4 py-3" key={item.stay_date}><div><p className="font-semibold">{new Date(`${item.stay_date}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}</p><p className="text-sm text-[var(--muted)]">{item.available_units} units available</p></div><p className="font-semibold">{money(item.nightly_rate, item.currency_code)}</p></div>)}</div> : <p className="mt-6 rounded-xl bg-[var(--sand)] p-4 text-sm text-[var(--muted)]">No date-specific rates have been saved for this month. The base nightly rate applies until you add an update.</p>}</section></div>}</section></main>;
}
