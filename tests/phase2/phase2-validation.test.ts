import { describe, expect, it } from "vitest";
import { propertyCreateSchema } from "../../src/lib/validation/property";
import { inventoryUpsertSchema, roomCreateSchema } from "../../src/lib/validation/room";
import { propertyDocumentUploadSchema, propertyMediaUploadSchema } from "../../src/lib/validation/upload";

const ID = "11111111-1111-4111-8111-111111111111";
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const dayAfterTomorrow = new Date(Date.now() + 172_800_000).toISOString().slice(0, 10);

const property = {
  destinationId: ID,
  slug: "serene-hillside-stay",
  name: "Serene Hillside Stay",
  addressLine1: "1 Mountain Road",
};

const room = {
  propertyId: ID,
  name: "Valley Suite",
  capacityAdults: 2,
  baseNightlyRate: 2500,
};

const inventory = {
  roomId: ID,
  startDate: tomorrow,
  endDate: dayAfterTomorrow,
  availableUnits: 1,
  nightlyRate: 2500,
};

describe("Phase 2 property schema", () => {
  it("accepts a minimal valid property and supported optional boundary values", () => {
    expect(propertyCreateSchema.safeParse({
      ...property,
      summary: "A".repeat(500),
      description: "A".repeat(10_000),
      latitude: -90,
      longitude: 180,
      maxGuests: 1_000,
      checkInTime: "00:00",
      checkOutTime: "23:59",
    }).success).toBe(true);
  });

  it("rejects malformed slug, out-of-range coordinates, guest counts, and identical stay times", () => {
    for (const invalid of [
      { ...property, slug: "Not Kebab Case" },
      { ...property, latitude: 90.01 },
      { ...property, longitude: -180.01 },
      { ...property, maxGuests: 0 },
      { ...property, checkInTime: "14:00", checkOutTime: "14:00" },
    ]) {
      expect(propertyCreateSchema.safeParse(invalid).success).toBe(false);
    }
  });
});

describe("Phase 2 room and inventory schemas", () => {
  it("enforces room capacity, monetary, and currency boundaries", () => {
    expect(roomCreateSchema.safeParse({
      ...room,
      capacityAdults: 1_000,
      capacityChildren: 1_000,
      baseNightlyRate: 99_999_999.99,
      currencyCode: "INR",
    }).success).toBe(true);

    for (const invalid of [
      { ...room, capacityAdults: 0 },
      { ...room, capacityChildren: -1 },
      { ...room, baseNightlyRate: -0.01 },
      { ...room, baseNightlyRate: 100_000_000 },
      { ...room, currencyCode: "inr" },
    ]) {
      expect(roomCreateSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("accepts inclusive inventory date ranges and blocking updates, and rejects past, reversed, and numeric limit violations", () => {
    expect(inventoryUpsertSchema.safeParse({
      ...inventory,
      startDate: tomorrow,
      endDate: tomorrow,
      availableUnits: 0,
      nightlyRate: 0,
      minimumNights: 365,
    }).success).toBe(true);

    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    for (const invalid of [
      { ...inventory, startDate: yesterday },
      { ...inventory, startDate: dayAfterTomorrow, endDate: tomorrow },
      { ...inventory, availableUnits: -1 },
      { ...inventory, availableUnits: 1_000_001 },
      { ...inventory, minimumNights: 366 },
    ]) {
      expect(inventoryUpsertSchema.safeParse(invalid).success).toBe(false);
    }
  });
});

describe("Phase 2 upload schemas", () => {
  const upload = { propertyId: ID, fileName: "front-view.jpg", contentType: "image/jpeg", fileSize: 10 * 1024 * 1024 };

  it("allows only each endpoint's declared MIME types up to the 10 MiB boundary", () => {
    expect(propertyMediaUploadSchema.safeParse(upload).success).toBe(true);
    expect(propertyMediaUploadSchema.safeParse({ ...upload, contentType: "image/webp" }).success).toBe(true);
    expect(propertyDocumentUploadSchema.safeParse({ ...upload, contentType: "application/pdf" }).success).toBe(true);
    expect(propertyMediaUploadSchema.safeParse({ ...upload, contentType: "application/pdf" }).success).toBe(false);
    expect(propertyDocumentUploadSchema.safeParse({ ...upload, contentType: "image/webp" }).success).toBe(false);
  });

  it("rejects unsafe filenames, oversized files, and undeclared fields", () => {
    for (const invalid of [
      { ...upload, fileName: "../front-view.jpg" },
      { ...upload, fileName: "nested/front-view.jpg" },
      { ...upload, fileSize: 10 * 1024 * 1024 + 1 },
      { ...upload, extra: "not allowed" },
    ]) {
      expect(propertyMediaUploadSchema.safeParse(invalid).success).toBe(false);
    }
  });
});
