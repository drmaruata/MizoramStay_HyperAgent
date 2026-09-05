import Link from "next/link";
import { redirect } from "next/navigation";
import InventoryEditor from "@/components/host/inventory-editor";
import RoomCreateForm from "@/components/host/room-create-form";
import { createClient } from "@/lib/supabase/server";

type Props = {
  searchParams: Promise<{ roomId?: string | string[] }>;
};

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function money(amount: number | string, currency: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(amount));
}

export default async function HostRoomsPage({ searchParams }: Props) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/host/rooms")}`);

  const selectedRoomId = one((await searchParams).roomId);
  const { data: properties, error: propertiesError } = await supabase
    .from("properties")
    .select("id,name")
    .eq("host_id", user.id)
    .order("created_at", { ascending: false });
  const propertyIds = properties?.map((property) => property.id) ?? [];
  const { data: rooms, error: roomsError } = propertyIds.length
    ? await supabase
        .from("rooms")
        .select("id,property_id,name,capacity_adults,capacity_children,beds_description,base_nightly_rate,currency_code,is_active")
        .in("property_id", propertyIds)
        .order("created_at", { ascending: false })
    : { data: [], error: null };

  const propertyNames = new Map((properties ?? []).map((property) => [property.id, property.name]));
  const activeRooms = rooms?.filter((room) => room.is_active) ?? [];
  const selectedRoom = rooms?.find((room) => room.id === selectedRoomId) ?? rooms?.[0] ?? null;

  return (
    <main className="min-h-screen bg-[var(--paper)]">
      <header className="border-b border-[var(--line)] bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link href="/" className="brand-mark text-lg font-bold">mizoram<span>stay</span></Link>
          <Link href="/host/dashboard" className="text-sm font-semibold">Host dashboard</Link>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-5 py-9 sm:py-12">
        <p className="eyebrow">Room inventory</p>
        <h1 className="serif mt-2 text-4xl sm:text-5xl">Rooms and capacity</h1>
        <p className="mt-3 text-[var(--muted)]">Create bookable rooms, then open dates and prices for each room.</p>

        {propertiesError || roomsError ? (
          <p className="mt-8 rounded-2xl bg-[var(--sand)] p-5 text-sm text-[var(--terracotta)]" role="alert">Rooms are temporarily unavailable. Please refresh and try again.</p>
        ) : !properties?.length ? (
          <section className="mt-8 rounded-2xl border border-dashed border-[var(--line)] bg-white p-8">
            <h2 className="text-xl font-semibold">Create a property first</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">Rooms are added to a property, so start by setting up your listing.</p>
            <Link href="/host/onboarding" className="mt-5 inline-flex rounded-full bg-[var(--terracotta)] px-5 py-3 text-sm font-semibold text-white">Set up a property</Link>
          </section>
        ) : (
          <>
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              <article className="rounded-2xl bg-[var(--deep)] p-6 text-white">
                <p className="text-sm text-white/70">Total guest capacity</p>
                <p className="mt-3 text-3xl font-semibold">{activeRooms.reduce((total, room) => total + room.capacity_adults + room.capacity_children, 0)} guests</p>
              </article>
              <article className="rounded-2xl border border-[var(--line)] bg-white p-6">
                <p className="text-sm text-[var(--muted)]">Listed rooms</p>
                <p className="mt-3 text-3xl font-semibold">{rooms?.length ?? 0}</p>
              </article>
              <article className="rounded-2xl border border-[var(--line)] bg-white p-6">
                <p className="text-sm text-[var(--muted)]">Active rooms</p>
                <p className="mt-3 text-3xl font-semibold">{activeRooms.length}</p>
              </article>
            </div>

            <div className="mt-8">
              <RoomCreateForm properties={properties} />
            </div>

            {!rooms?.length ? (
              <section className="mt-8 rounded-2xl border border-dashed border-[var(--line)] bg-white p-8">
                <h2 className="text-xl font-semibold">No rooms yet</h2>
                <p className="mt-2 text-sm text-[var(--muted)]">Create your first room above, then add date-specific availability and prices.</p>
              </section>
            ) : (
              <>
                <section className="mt-8 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
                  <div className="border-b border-[var(--line)] px-6 py-5">
                    <h2 className="text-xl font-semibold">Room list</h2>
                  </div>
                  <div className="divide-y divide-[var(--line)]">
                    {rooms.map((room) => (
                      <article key={room.id} className="grid gap-4 px-6 py-6 md:grid-cols-[1.4fr_1fr_auto] md:items-center">
                        <div>
                          <h3 className="font-semibold">{room.name}</h3>
                          <p className="mt-1 text-sm text-[var(--muted)]">{propertyNames.get(room.property_id)} - {room.beds_description || "Bed details pending"}</p>
                          <p className="mt-1 text-sm text-[var(--muted)]">Sleeps {room.capacity_adults} adult{room.capacity_adults === 1 ? "" : "s"}{room.capacity_children ? ` and ${room.capacity_children} child${room.capacity_children === 1 ? "" : "ren"}` : ""}</p>
                        </div>
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Base rate</p>
                          <p className="mt-1 font-semibold">{money(room.base_nightly_rate, room.currency_code)} / night</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 md:justify-end">
                          <span className="rounded-full bg-[var(--sand)] px-2.5 py-1 text-center text-xs font-semibold">{room.is_active ? "Active" : "Inactive"}</span>
                          <Link className="rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-semibold" href={`/host/rooms?roomId=${encodeURIComponent(room.id)}`}>Manage dates</Link>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>

                {selectedRoom && (
                  <div className="mt-8">
                    <InventoryEditor roomId={selectedRoom.id} roomName={selectedRoom.name} />
                  </div>
                )}
              </>
            )}
          </>
        )}
      </section>
    </main>
  );
}
