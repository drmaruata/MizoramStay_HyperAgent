import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const runIntegration = process.env.RUN_SUPABASE_INTEGRATION === "true";
const integrationDescribe = runIntegration ? describe : describe.skip;

type TestCredentials = {
  email: string;
  password: string;
};

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required when RUN_SUPABASE_INTEGRATION=true`);
  }
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

integrationDescribe("Phase 2 authenticated ownership policies", () => {
  let ownerOne: SupabaseClient;
  let ownerTwo: SupabaseClient;
  let ownerOneId: string;
  let ownerTwoId: string;
  let destinationId: string;
  let propertyId: string | undefined;
  let roomId: string | undefined;
  let mediaPath: string | undefined;

  beforeAll(async () => {
    const [first, second] = await Promise.all([
      authenticatedClient(credentials("OWNER_ONE")),
      authenticatedClient(credentials("OWNER_TWO")),
    ]);

    ownerOne = first.client;
    ownerTwo = second.client;
    ownerOneId = first.userId;
    ownerTwoId = second.userId;
    expect(ownerOneId).not.toBe(ownerTwoId);

    const [{ data: ownerOneProfile }, { data: ownerTwoProfile }] = await Promise.all([
      ownerOne.from("profiles").select("role").eq("id", ownerOneId).single(),
      ownerTwo.from("profiles").select("role").eq("id", ownerTwoId).single(),
    ]);
    expect(ownerOneProfile?.role).toBe("host");
    expect(ownerTwoProfile?.role).toBe("host");

    const { data: destination, error } = await ownerOne
      .from("destinations")
      .select("id")
      .eq("is_active", true)
      .limit(1)
      .single();
    expect(error).toBeNull();
    expect(destination).not.toBeNull();
    destinationId = destination!.id;
  }, 30_000);

  afterAll(async () => {
    if (mediaPath && ownerOne) {
      await ownerOne.storage.from("property-media").remove([mediaPath]);
    }
    if (propertyId && ownerOne) {
      await ownerOne.from("properties").delete().eq("id", propertyId);
    }
    await Promise.all([
      ownerOne?.auth.signOut() ?? Promise.resolve(),
      ownerTwo?.auth.signOut() ?? Promise.resolve(),
    ]);
  });

  it("lets an owner manage their property, room, and inventory while denying the other owner", async () => {
    const unique = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const { data: property, error: propertyError } = await ownerOne
      .from("properties")
      .insert({
        host_id: ownerOneId,
        destination_id: destinationId,
        slug: `phase2-owner-${unique}`,
        name: `Phase 2 Owner ${unique}`,
        address_line1: "Integration test fixture",
        max_guests: 2,
        status: "draft",
      })
      .select("id,host_id")
      .single();

    expect(propertyError).toBeNull();
    expect(property?.host_id).toBe(ownerOneId);
    propertyId = property!.id;

    const { data: room, error: roomError } = await ownerOne
      .from("rooms")
      .insert({
        property_id: propertyId,
        name: `Phase 2 Room ${unique}`,
        capacity_adults: 2,
        capacity_children: 0,
        base_nightly_rate: 2500,
        currency_code: "INR",
      })
      .select("id,property_id")
      .single();

    expect(roomError).toBeNull();
    expect(room?.property_id).toBe(propertyId);
    roomId = room!.id;

    const stayDate = isoDateFromNow(3);
    const { data: inventory, error: inventoryError } = await ownerOne
      .from("nightly_inventory")
      .insert({
        room_id: roomId,
        stay_date: stayDate,
        available_units: 1,
        nightly_rate: 2500,
        currency_code: "INR",
        minimum_nights: 1,
      })
      .select("room_id,stay_date")
      .single();

    expect(inventoryError).toBeNull();
    expect(inventory).toMatchObject({ room_id: roomId, stay_date: stayDate });

    const [{ data: hiddenProperty }, { data: hiddenRoom }, { data: hiddenInventory }] = await Promise.all([
      ownerTwo.from("properties").select("id").eq("id", propertyId).maybeSingle(),
      ownerTwo.from("rooms").select("id").eq("id", roomId).maybeSingle(),
      ownerTwo.from("nightly_inventory").select("room_id").eq("room_id", roomId),
    ]);
    expect(hiddenProperty).toBeNull();
    expect(hiddenRoom).toBeNull();
    expect(hiddenInventory).toEqual([]);

    const [{ error: propertyWriteError }, { error: roomWriteError }, { error: inventoryWriteError }] = await Promise.all([
      ownerTwo.from("properties").insert({
        host_id: ownerOneId,
        destination_id: destinationId,
        slug: `phase2-cross-owner-${unique}`,
        name: `Cross owner ${unique}`,
        address_line1: "Rejected integration fixture",
        status: "draft",
      }),
      ownerTwo.from("rooms").insert({
        property_id: propertyId,
        name: `Cross owner room ${unique}`,
        capacity_adults: 1,
        capacity_children: 0,
        base_nightly_rate: 1000,
        currency_code: "INR",
      }),
      ownerTwo.from("nightly_inventory").insert({
        room_id: roomId,
        stay_date: isoDateFromNow(4),
        available_units: 1,
        nightly_rate: 1000,
        currency_code: "INR",
        minimum_nights: 1,
      }),
    ]);

    expect(propertyWriteError).not.toBeNull();
    expect(roomWriteError).not.toBeNull();
    expect(inventoryWriteError).not.toBeNull();

    mediaPath = `${ownerOneId}/${propertyId}/integration-${unique}.png`;
    const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const { error: crossOwnerUploadError } = await ownerTwo.storage
      .from("property-media")
      .upload(mediaPath, imageBytes, { contentType: "image/png", upsert: false });
    expect(crossOwnerUploadError).not.toBeNull();

    const { error: ownerUploadError } = await ownerOne.storage
      .from("property-media")
      .upload(mediaPath, imageBytes, { contentType: "image/png", upsert: false });
    expect(ownerUploadError).toBeNull();

    const { error: mediaMetadataError } = await ownerOne.from("property_media").insert({
      property_id: propertyId,
      kind: "image",
      storage_path: mediaPath,
      alt_text: "Phase 2 integration fixture",
      sort_order: 0,
      is_cover: true,
    });
    expect(mediaMetadataError).toBeNull();

    const { data: submitted, error: submissionError } = await ownerOne.rpc("submit_property_for_review", {
      p_property_id: propertyId,
    });
    expect(submissionError).toBeNull();
    expect(submitted?.status).toBe("submitted");
  }, 45_000);
});
