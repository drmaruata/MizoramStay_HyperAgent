import { describe, expect, it } from "vitest";
import {
  reviewIdSchema,
  reviewResponseSchema,
  reviewSubmissionSchema,
} from "../../src/lib/validation/review";
import {
  createSupportCaseSchema,
  supportCaseActionSchema,
  supportCaseIdSchema,
  supportCaseListQuerySchema,
} from "../../src/lib/validation/support";
import {
  verificationDecisionSchema,
  verificationListQuerySchema,
} from "../../src/lib/validation/verification";

const ID = "11111111-1111-4111-8111-111111111111";

describe("Phase 4 review validation", () => {
  it("normalizes valid review submissions and host responses at their boundaries", () => {
    expect(reviewSubmissionSchema.parse({
      bookingId: ID,
      rating: 5,
      title: "  A memorable stay  ",
      body: `  ${"x".repeat(10)}  `,
    })).toEqual({
      bookingId: ID,
      rating: 5,
      title: "A memorable stay",
      body: "x".repeat(10),
    });
    expect(reviewSubmissionSchema.parse({
      bookingId: ID,
      rating: 1,
      title: "   ",
      body: "x".repeat(2000),
    }).title).toBeUndefined();
    expect(reviewResponseSchema.parse({ response: "  Thank you  " })).toEqual({ response: "Thank you" });
    expect(reviewIdSchema.safeParse(ID).success).toBe(true);
  });

  it("rejects malformed IDs, ratings, content lengths, and undeclared fields", () => {
    const valid = { bookingId: ID, rating: 4, body: "A lovely stay." };
    for (const invalid of [
      { ...valid, bookingId: "booking-1" },
      { ...valid, rating: 0 },
      { ...valid, rating: 6 },
      { ...valid, rating: 4.5 },
      { ...valid, body: "too short" },
      { ...valid, body: "x".repeat(2001) },
      { ...valid, title: "x".repeat(121) },
      { ...valid, moderationStatus: "approved" },
    ]) {
      expect(reviewSubmissionSchema.safeParse(invalid).success).toBe(false);
    }
    expect(reviewIdSchema.safeParse("not-a-review-id").success).toBe(false);
    expect(reviewResponseSchema.safeParse({ response: "x" }).success).toBe(false);
    expect(reviewResponseSchema.safeParse({ response: "x".repeat(2001) }).success).toBe(false);
    expect(reviewResponseSchema.safeParse({ response: "Thanks", approved: true }).success).toBe(false);
  });
});

describe("Phase 4 support validation", () => {
  it("trims a case, applies safe defaults, and coerces bounded list pagination", () => {
    expect(createSupportCaseSchema.parse({
      subject: "  Booking assistance  ",
      message: "  Please help with my booking.  ",
      category: "booking",
    })).toEqual({
      subject: "Booking assistance",
      message: "Please help with my booking.",
      category: "booking",
      priority: "normal",
    });
    expect(supportCaseListQuerySchema.parse({ limit: "100", offset: "0", status: "open" })).toEqual({
      limit: 100,
      offset: 0,
      status: "open",
    });
    expect(supportCaseIdSchema.safeParse(ID).success).toBe(true);
  });

  it("rejects invalid ownership-linked IDs, enums, pagination, content, and extra input", () => {
    const valid = { subject: "Payment question", message: "Please investigate.", category: "payment" };
    for (const invalid of [
      { ...valid, subject: "four" },
      { ...valid, message: " " },
      { ...valid, category: "refund" },
      { ...valid, priority: "critical" },
      { ...valid, bookingId: "not-a-uuid" },
      { ...valid, customerId: ID },
    ]) {
      expect(createSupportCaseSchema.safeParse(invalid).success).toBe(false);
    }
    for (const invalid of [
      { limit: "0" },
      { limit: "101" },
      { offset: "-1" },
      { status: "pending" },
      { unknown: "filter" },
    ]) {
      expect(supportCaseListQuerySchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("enforces the message, assignment, and resolution discriminated contracts", () => {
    expect(supportCaseActionSchema.parse({ action: "message", message: "  Any update?  " })).toEqual({
      action: "message",
      message: "Any update?",
      internal: false,
    });
    expect(supportCaseActionSchema.safeParse({ action: "assign", assigneeId: null, priority: "urgent" }).success).toBe(true);
    expect(supportCaseActionSchema.safeParse({ action: "resolve", resolution: "Resolved after confirming the refund." }).success).toBe(true);

    for (const invalid of [
      { action: "message", message: "", internal: false },
      { action: "message", message: "Visible reply", internal: "yes" },
      { action: "assign", assigneeId: "admin-1" },
      { action: "resolve", resolution: "too short" },
      { action: "close", resolution: "Resolved after investigation." },
      { action: "assign", priority: "high", resolution: "not allowed" },
    ]) {
      expect(supportCaseActionSchema.safeParse(invalid).success).toBe(false);
    }
  });
});

describe("Phase 4 administrator validation", () => {
  it("accepts bounded verification queue and decision requests", () => {
    expect(verificationListQuerySchema.parse({ reviewLevel: "5", limit: "1", offset: "100000" })).toEqual({
      reviewLevel: 5,
      limit: 1,
      offset: 100000,
    });
    expect(verificationDecisionSchema.safeParse({ action: "claim", reviewLevel: 0 }).success).toBe(true);
    expect(verificationDecisionSchema.safeParse({
      action: "decide",
      decision: "changes_requested",
      reviewLevel: 2,
      notes: "Please replace the unreadable document.",
      changeRequests: [{ fieldName: "identity_document", instruction: "Upload a legible copy." }],
    }).success).toBe(true);
  });

  it("rejects unsafe admin filters and incomplete or contradictory decisions", () => {
    for (const invalid of [
      { reviewLevel: "" },
      { reviewLevel: "6" },
      { limit: "0" },
      { offset: "100001" },
      { status: "pending" },
      { extra: "field" },
    ]) {
      expect(verificationListQuerySchema.safeParse(invalid).success).toBe(false);
    }
    for (const invalid of [
      { action: "decide", decision: "changes_requested", reviewLevel: 1 },
      { action: "decide", decision: "rejected", reviewLevel: 1, changeRequests: [] },
      { action: "decide", decision: "approved", reviewLevel: 1, changeRequests: [{ fieldName: "name", instruction: "Change it" }] },
      { action: "decide", decision: "approved", reviewLevel: 6, changeRequests: [] },
      { action: "claim", reviewLevel: 1, notes: "not allowed" },
    ]) {
      expect(verificationDecisionSchema.safeParse(invalid).success).toBe(false);
    }
  });
});
