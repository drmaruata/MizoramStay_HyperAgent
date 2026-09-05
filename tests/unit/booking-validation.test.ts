import { describe, expect, it } from "vitest";
import { bookingHoldSchema } from "../../src/lib/validation/booking";

const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 2);
const departure = new Date(tomorrow);
departure.setDate(departure.getDate() + 3);

const validHold = {
  propertyId: "11111111-1111-4111-8111-111111111111",
  roomId: "22222222-2222-4222-8222-222222222222",
  contactName: "Test Traveller",
  contactEmail: "traveller@example.test",
  contactPhone: "+919876543210",
  checkIn: tomorrow.toISOString().slice(0, 10),
  checkOut: departure.toISOString().slice(0, 10),
  guests: 2,
  idempotencyKey: "99999999-9999-4999-8999-999999999999",
};

describe("bookingHoldSchema", () => {
  it("accepts a complete future booking request", () => {
    expect(bookingHoldSchema.safeParse(validHold).success).toBe(true);
  });

  it("rejects invalid stay dates", () => {
    expect(bookingHoldSchema.safeParse({ ...validHold, checkOut: validHold.checkIn }).success).toBe(false);
  });

  it("rejects missing guest contact details", () => {
    expect(bookingHoldSchema.safeParse({ ...validHold, contactEmail: "not-an-email" }).success).toBe(false);
  });
});
