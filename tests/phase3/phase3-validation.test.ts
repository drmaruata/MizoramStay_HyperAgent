import { describe, expect, it } from "vitest";
import {
  bookingIdSchema,
  cancelBookingSchema,
  paymentOrderSchema,
} from "../../src/lib/validation/phase3-booking";

const BOOKING_ID = "11111111-1111-4111-8111-111111111111";

describe("Phase 3 booking identifier validation", () => {
  it("accepts an RFC-compatible UUID and reuses the same boundary for payment orders", () => {
    expect(bookingIdSchema.safeParse(BOOKING_ID).success).toBe(true);
    expect(paymentOrderSchema.safeParse({ bookingId: BOOKING_ID }).success).toBe(true);
  });

  it("rejects malformed identifiers and undeclared payment-order fields", () => {
    for (const invalid of ["", "booking-123", "11111111-1111-1111-1111-111111111111", `${BOOKING_ID} `]) {
      expect(bookingIdSchema.safeParse(invalid).success).toBe(false);
      expect(paymentOrderSchema.safeParse({ bookingId: invalid }).success).toBe(false);
    }

    expect(paymentOrderSchema.safeParse({ bookingId: BOOKING_ID, amount: 1 }).success).toBe(false);
  });
});

describe("Phase 3 cancellation validation", () => {
  it("trims and accepts reasons at the inclusive 10 and 500 character boundaries", () => {
    expect(cancelBookingSchema.parse({ reason: "  1234567890  " })).toEqual({ reason: "1234567890" });
    expect(cancelBookingSchema.safeParse({ reason: "x".repeat(500) }).success).toBe(true);
  });

  it("rejects blank, short, oversized, non-string, and undeclared input", () => {
    for (const invalid of [
      null,
      {},
      { reason: "          " },
      { reason: "123456789" },
      { reason: "x".repeat(501) },
      { reason: 1234567890 },
      { reason: "A valid cancellation reason", bookingId: BOOKING_ID },
    ]) {
      expect(cancelBookingSchema.safeParse(invalid).success).toBe(false);
    }
  });
});
