import Link from "next/link";
import { redirect } from "next/navigation";
import InventoryEditor from "@/components/host/inventory-editor";
import { createClient } from "@/lib/supabase/server";

const dateKey = (date: Date) => date.toISOString().slice(0, 10);

export default async function HostCalendarPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/host/calendar")}`);
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  const { data: properties, error: propertiesError } = await supabase.from("properties").select("id").eq("host_id", user.id);
  const propertyIds = properties?.map((property) => property.id) ?? [];
  const { data: rooms, error: roomsError } = propertyIds.length ? await supabase.from("rooms").select("id,name").in("property_id", propertyIds).eq("is_active", true) : { data: [], error: null };
  const roomIds = rooms?.map((room) => room.id) ?? [];
  const { data: inventory, error: inventoryError } = roomIds.length ? await supabase.from("nightly_inventory").select("room_id,stay_date,available_units").in("room_id", roomIds).gte("stay_date", dateKey(first)).lte("stay_date", dateKey(last)) : { data: [], error: null };
  const inventoryByDate = new Map<string, number>();
  for (const item of inventory ?? []) inventoryByDate.set(item.stay_date, (inventoryByDate.get(item.stay_date) ?? 0) + item.available_units);
  const offset = (first.getUTCDay() + 6) % 7;
  const cells = Array.from({ length: offset + last.getUTCDate() }, (_, index) => index < offset ? null : new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), index - offset + 1)));
  const monthName = first.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

  return <main className="min-h-screen bg-[var(--paper)]"><header className="border-b border-[var(--line)] bg-white"><div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4"><Link href="/" className="brand-mark text-lg font-bold">mizoram<span>stay</span></Link><Link href="/host/dashboard" className="text-sm font-semibold">Host dashboard</Link></div></header><section className="mx-auto max-w-6xl px-5 py-9 sm:py-12"><p className="eyebrow">Availability</p><h1 className="serif mt-2 text-4xl sm:text-5xl">Your calendar</h1><p className="mt-3 text-[var(--muted)]">Live availability for your active rooms this month.</p>{propertiesError || roomsError || inventoryError ? <p className="mt-8 rounded-2xl bg-[var(--sand)] p-5 text-sm text-[var(--terracotta)]">Availability is temporarily unavailable. Please refresh and try again.</p> : !rooms?.length ? <section className="mt-8 rounded-2xl border border-dashed border-[var(--line)] bg-white p-8"><h2 className="text-xl font-semibold">No active rooms to schedule</h2><p className="mt-2 text-sm text-[var(--muted)]">Add and activate a room before setting nightly availability.</p><Link className="mt-5 inline-flex rounded-full bg-[var(--terracotta)] px-5 py-3 text-sm font-semibold text-white" href="/host/rooms">Manage rooms</Link></section> : <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_330px]"><section className="rounded-2xl border border-[var(--line)] bg-white p-5 sm:p-7"><h2 className="text-xl font-semibold">{monthName}</h2><div className="mt-6 grid grid-cols-7 gap-1.5 text-center sm:gap-2">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <div className="pb-2 text-xs font-bold uppercase tracking-wide text-[var(--muted)]" key={day}>{day}</div>)}{cells.map((date, index) => { const units = date ? inventoryByDate.get(dateKey(date)) : undefined; return <div key={index} className={`flex aspect-square flex-col items-center justify-center rounded-lg text-sm ${!date ? "" : units === undefined ? "bg-[var(--sand)] text-[var(--muted)]" : units > 0 ? "bg-[var(--sky)] text-[var(--forest)]" : "bg-[var(--ink)] text-white"}`}>{date && <><span className="font-semibold">{date.getUTCDate()}</span><span className="text-[10px]">{units === undefined ? "Unset" : units > 0 ? `${units} open` : "Closed"}</span></>}</div>; })}</div></section><InventoryEditor roomId={rooms[0].id} roomName={rooms[0].name} /></div>}</section></main>;
}
