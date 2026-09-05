import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const runIntegration = process.env.RUN_SUPABASE_INTEGRATION === "true";
const integrationDescribe = runIntegration ? describe : describe.skip;

type TestCredentials = {
  email: string;
  password: string;
};

type BookingHold = {
  id: string;
  guest_id: string;
  property_id: string;
  status: string;
  idempotency_key: string;
};

type CancellationRequest = {
  id: string;
  booking_id: string;
  requested_by: string;
  status: string;
  idempotency_key: string;
};

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required when RUN_SUPABASE_INTEGRATION=true`);
  return value;
}

function credentials(prefix: "OWNER_ONE" | "OWNER_TWO"): TestCredentials {
  return {
    email: requiredEnvironment(`SUPABASE_TEST_${prefix}_EMAIL`),
    password: requiredEnvironment(`SUPABASE_TEST_${prefix}_PASSWORD`),
  };
}

function isoDateFromNow(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function authenticatedClient(testCredentials: TestCredentials) {
  const client = createClient(
    requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnvironment("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await client.auth.signInWithPassword(testCredentials);

  expect(error).toBeNull();
  expect(data.user).not.toBeNull();
  return { client, userId: data.user!.id };
}

integrationDescribe("Phase 3 atomic booking lifecycle", () => {
  let guest: SupabaseClient;
  let otherUser: SupabaseClient;
  let service: SupabaseClient;
  let guestId: string;
  let otherUserId: string;
  let destinationId: string;
  let propertyId: string | undefined;
  let roomId: string | undefined;
  let bookingId: string | undefined;
  let cancellationId: string | undefined;

  const checkIn = isoDateFromNow(10);
  const checkOut = isoDateFromNow(12);

  beforeAll(async () => {
    const [first, second] = await Promise.all([
      authenticatedClient(credentials("OWNER_ONE")),
      authenticatedClient(credentials("OWNER_TWO")),
    ]);

    guest = first.client;
    otherUser = second.client;
    guestId = first.userId;
    otherUserId = second.userId;
    expect(guestId).not.toBe(otherUserId);

    service = createClient(
      requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL"),
      requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const [{ data: profile, error: profileError }, { data: destination, error: destinationError }] = await Promise.all([
      guest.from("profiles").select("id").eq("id", guestId).single(),
      service.from("destinations").select("id").eq("is_active", true).limit(1).single(),
    ]);
    expect(profileError).toBeNull();
    expect(profile?.id).toBe(guestId);
    expect(destinationError).toBeNull();
    expect(destination).not.toBeNull();
    destinationId = destination!.id;
  }, 30_000);

  afterAll(async () => {
    if (bookingId) {
      await service.from("notification_outbox").delete().contains("payload", { booking_id: bookingId });
      await service.from("audit_logs").delete().eq("entity_id", bookingId);
    }
    if (cancellationId) {
      await service.from("audit_logs").delete().eq("entity_id", cancellationId);
    }
    if (bookingId) {
      await service.from("cancellation_requests").delete().eq("booking_id", bookingId);
      await service.from("bookings").delete().eq("id", bookingId);
    }
    if (propertyId) await service.from("properties").delete().eq("id", propertyId);

    await Promise.all([
      guest?.auth.signOut() ?? Promise.resolve(),
      otherUser?.auth.signOut() ?? Promise.resolve(),
    ]);
  }, 30_000);

  it("is idempotent, decrements inventory, denies cross-user access, and restores inventory once with outbox records", async () => {
    const unique = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const { data: property, error: propertyError } = await service
      .from("properties")
      .insert({
        host_id: null,
        destination_id: destinationId,
        slug: `phase3-booking-${unique}`,
        name: `Phase 3 Booking ${unique}`,
        address_line1: "Integration test fixture",
        max_guests: 2,
        status: "published",
        published_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    expect(propertyError).toBeNull();
    propertyId = property!.id;

    const { data: room, error: roomError } = await service
      .from("rooms")
      .insert({
        property_id: propertyId,
        name: `Phase 3 Room ${unique}`,
        capacity_adults: 2,
        capacity_children: 0,
        base_nightly_rate: 2500,
        currency_code: "INR",
      })
      .select("id")
      .single();
    expect(roomError).toBeNull();
    roomId = room!.id;

    const fixtureInventory = [checkIn, isoDateFromNow(11)].map((stayDate) => ({
      room_id: roomId,
      stay_date: stayDate,
      available_units: 2,
      nightly_rate: 2500,
      currency_code: "INR",
      minimum_nights: 1,
    }));
    const { error: inventoryError } = await service.from("nightly_inventory").insert(fixtureInventory);
    expect(inventoryError).toBeNull();

    const idempotencyKey = crypto.randomUUID();
    const holdArguments = {
      p_property_id: propertyId,
      p_room_id: roomId,
      p_check_in: checkIn,
      p_check_out: checkOut,
      p_guest_count: 2,
      p_contact_name: "Phase Three Guest",
      p_contact_email: credentials("OWNER_ONE").email,
      p_contact_phone: null,
      p_idempotency_key: idempotencyKey,
    };

    const firstHold = await guest.rpc("create_booking_hold", holdArguments);
    const retryHold = await guest.rpc("create_booking_hold", holdArguments);
    expect(firstHold.error).toBeNull();
    expect(retryHold.error).toBeNull();

    const firstBooking = firstHold.data as BookingHold;
    const retriedBooking = retryHold.data as BookingHold;
    bookingId = firstBooking.id;
    expect(retriedBooking.id).toBe(bookingId);
    expect(firstBooking).toMatchObject({
      guest_id: guestId,
      property_id: propertyId,
      status: "hold",
      idempotency_key: idempotencyKey,
    });

    const { count: holdCount, error: holdCountError } = await service
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("guest_id", guestId)
      .eq("idempotency_key", idempotencyKey);
    expect(holdCountError).toBeNull();
    expect(holdCount).toBe(1);

    const { data: decremented, error: decrementedError } = await service
      .from("nightly_inventory")
      .select("stay_date,available_units")
      .eq("room_id", roomId)
      .gte("stay_date", checkIn)
      .lt("stay_date", checkOut)
      .order("stay_date");
    expect(decrementedError).toBeNull();
    expect(decremented).toEqual([
      { stay_date: checkIn, available_units: 1 },
      { stay_date: isoDateFromNow(11), available_units: 1 },
    ]);

    const [{ data: hiddenBooking, error: hiddenError }, deniedCancellation] = await Promise.all([
      otherUser.from("bookings").select("id").eq("id", bookingId).maybeSingle(),
      otherUser.rpc("cancel_booking", {
        p_booking_id: bookingId,
        p_reason: "Another user must not cancel this hold.",
        p_idempotency_key: `cross-user:${bookingId}`,
      }),
    ]);
    expect(hiddenError).toBeNull();
    expect(hiddenBooking).toBeNull();
    expect(deniedCancellation.error).not.toBeNull();
    expect(deniedCancellation.error?.code).toBe("42501");

    const cancellationKey = `phase3-cancel:${bookingId}`;
    const cancellationArguments = {
      p_booking_id: bookingId,
      p_reason: "The integration fixture has completed its lifecycle.",
      p_idempotency_key: cancellationKey,
    };
    const firstCancellation = await guest.rpc("cancel_booking", cancellationArguments);
    const retryCancellation = await guest.rpc("cancel_booking", cancellationArguments);
    expect(firstCancellation.error).toBeNull();
    expect(retryCancellation.error).toBeNull();

    const cancelled = firstCancellation.data as CancellationRequest;
    const retriedCancellation = retryCancellation.data as CancellationRequest;
    cancellationId = cancelled.id;
    expect(retriedCancellation.id).toBe(cancellationId);
    expect(cancelled).toMatchObject({
      booking_id: bookingId,
      requested_by: guestId,
      status: "completed",
      idempotency_key: cancellationKey,
    });

    const { data: finalBooking, error: finalBookingError } = await service
      .from("bookings")
      .select("status,inventory_released_at,cancelled_at")
      .eq("id", bookingId)
      .single();
    expect(finalBookingError).toBeNull();
    expect(finalBooking?.status).toBe("cancelled");
    expect(finalBooking?.inventory_released_at).not.toBeNull();
    expect(finalBooking?.cancelled_at).not.toBeNull();

    const { data: restored, error: restoredError } = await service
      .from("nightly_inventory")
      .select("stay_date,available_units")
      .eq("room_id", roomId)
      .gte("stay_date", checkIn)
      .lt("stay_date", checkOut)
      .order("stay_date");
    expect(restoredError).toBeNull();
    expect(restored).toEqual([
      { stay_date: checkIn, available_units: 2 },
      { stay_date: isoDateFromNow(11), available_units: 2 },
    ]);

    const { count: cancellationCount, error: cancellationCountError } = await service
      .from("cancellation_requests")
      .select("id", { count: "exact", head: true })
      .eq("booking_id", bookingId);
    expect(cancellationCountError).toBeNull();
    expect(cancellationCount).toBe(1);

    const { data: outbox, error: outboxError } = await service
      .from("notification_outbox")
      .select("template_key,idempotency_key,payload")
      .contains("payload", { booking_id: bookingId })
      .order("template_key");
    expect(outboxError).toBeNull();
    expect(outbox?.map((entry) => entry.template_key)).toEqual(["booking_cancelled_guest"]);
    expect(new Set(outbox?.map((entry) => entry.idempotency_key)).size).toBe(1);
  }, 60_000);
});
