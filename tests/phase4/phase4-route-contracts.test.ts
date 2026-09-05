import { beforeEach, describe, expect, it, vi } from "vitest";

const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/validation/review", async () => import("../../src/lib/validation/review"));
vi.mock("@/lib/validation/support", async () => import("../../src/lib/validation/support"));
vi.mock("@/lib/validation/verification", async () => import("../../src/lib/validation/verification"));

const ID = "11111111-1111-4111-8111-111111111111";

function jsonRequest(url: string, body: unknown, method = "POST") {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function unauthenticatedClient() {
  const from = vi.fn();
  const rpc = vi.fn();
  return {
    client: {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
      from,
      rpc,
    },
    from,
    rpc,
  };
}

describe("Phase 4 validation contracts before database access", () => {
  beforeEach(() => createClient.mockReset());

  it("rejects invalid review submission and response requests", async () => {
    const [{ POST: submitReview }, { POST: respondToReview }] = await Promise.all([
      import("../../src/app/api/v1/reviews/route"),
      import("../../src/app/api/v1/reviews/[id]/response/route"),
    ]);

    const responses = await Promise.all([
      submitReview(jsonRequest("http://localhost/api/v1/reviews", { bookingId: ID, rating: 0, body: "too short" })),
      respondToReview(jsonRequest("http://localhost/api/v1/reviews/not-a-uuid/response", { response: "Thanks" }), {
        params: Promise.resolve({ id: "not-a-uuid" }),
      }),
      respondToReview(jsonRequest(`http://localhost/api/v1/reviews/${ID}/response`, { response: "x" }), {
        params: Promise.resolve({ id: ID }),
      }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([400, 400, 400]);
    expect(await responses[0].json()).toMatchObject({ error: "Invalid review" });
    expect(await responses[1].json()).toEqual({ error: "Invalid review id" });
    expect(await responses[2].json()).toMatchObject({ error: "Invalid host response" });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects invalid support creation, list, identifier, and action requests", async () => {
    const [{ GET: listCases, POST: createCase }, { GET: readCase, PATCH: updateCase }] = await Promise.all([
      import("../../src/app/api/v1/support/route"),
      import("../../src/app/api/v1/support/[id]/route"),
    ]);

    const responses = await Promise.all([
      listCases(new Request("http://localhost/api/v1/support?limit=101")),
      createCase(jsonRequest("http://localhost/api/v1/support", { subject: "no", message: "", category: "unknown" })),
      readCase(new Request("http://localhost/api/v1/support/not-a-uuid"), { params: Promise.resolve({ id: "not-a-uuid" }) }),
      updateCase(jsonRequest(`http://localhost/api/v1/support/${ID}`, { action: "resolve", resolution: "short" }, "PATCH"), {
        params: Promise.resolve({ id: ID }),
      }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([400, 400, 400, 400]);
    expect(await responses[0].json()).toMatchObject({ error: "Invalid support case query" });
    expect(await responses[1].json()).toMatchObject({ error: "Invalid support case" });
    expect(await responses[2].json()).toEqual({ error: "Invalid support case id" });
    expect(await responses[3].json()).toMatchObject({ error: "Invalid support case action" });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects malformed moderation, audit, analytics, and verification admin input", async () => {
    const [
      { POST: moderateReview },
      { GET: readAudit },
      { GET: readAnalytics },
      { GET: listVerifications },
      { POST: decideVerification },
    ] = await Promise.all([
      import("../../src/app/api/v1/admin/reviews/[id]/moderate/route"),
      import("../../src/app/api/v1/admin/audit/route"),
      import("../../src/app/api/v1/admin/analytics/route"),
      import("../../src/app/api/v1/admin/verifications/route"),
      import("../../src/app/api/v1/admin/verifications/[id]/decision/route"),
    ]);

    const responses = await Promise.all([
      moderateReview(jsonRequest(`http://localhost/api/v1/admin/reviews/${ID}/moderate`, { decision: "approved", notes: "x" }), {
        params: Promise.resolve({ id: ID }),
      }),
      readAudit(new Request("http://localhost/api/v1/admin/audit?entity=review%20drop&pageSize=101")),
      readAnalytics(new Request("http://localhost/api/v1/admin/analytics?days=30.5")),
      listVerifications(new Request("http://localhost/api/v1/admin/verifications?reviewLevel=6")),
      decideVerification(jsonRequest(`http://localhost/api/v1/admin/verifications/${ID}/decision`, {
        action: "decide",
        decision: "changes_requested",
        reviewLevel: 1,
      }), { params: Promise.resolve({ id: ID }) }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([400, 400, 400, 400, 400]);
    expect(await responses[0].json()).toMatchObject({ error: "Invalid moderation decision" });
    expect(await responses[1].json()).toMatchObject({ error: "Invalid audit query" });
    expect(await responses[2].json()).toEqual({ error: "Analytics period must be an integer between 1 and 365 days" });
    expect(await responses[3].json()).toMatchObject({ error: "Invalid verification queue query" });
    expect(await responses[4].json()).toMatchObject({ error: "Invalid verification action" });
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe("Phase 4 unauthenticated route contracts", () => {
  beforeEach(() => createClient.mockReset());

  it("denies valid review and support operations before protected reads or RPC calls", async () => {
    const { client, from, rpc } = unauthenticatedClient();
    createClient.mockResolvedValue(client);
    const [
      { POST: submitReview },
      { POST: respondToReview },
      { GET: listCases, POST: createCase },
      { GET: readCase, PATCH: updateCase },
    ] = await Promise.all([
      import("../../src/app/api/v1/reviews/route"),
      import("../../src/app/api/v1/reviews/[id]/response/route"),
      import("../../src/app/api/v1/support/route"),
      import("../../src/app/api/v1/support/[id]/route"),
    ]);

    const responses = await Promise.all([
      submitReview(jsonRequest("http://localhost/api/v1/reviews", { bookingId: ID, rating: 5, body: "A wonderful completed stay." })),
      respondToReview(jsonRequest(`http://localhost/api/v1/reviews/${ID}/response`, { response: "Thank you" }), {
        params: Promise.resolve({ id: ID }),
      }),
      listCases(new Request("http://localhost/api/v1/support")),
      createCase(jsonRequest("http://localhost/api/v1/support", {
        subject: "Booking assistance",
        message: "Please help with this booking.",
        category: "booking",
      })),
      readCase(new Request(`http://localhost/api/v1/support/${ID}`), { params: Promise.resolve({ id: ID }) }),
      updateCase(jsonRequest(`http://localhost/api/v1/support/${ID}`, { action: "message", message: "Any update?" }, "PATCH"), {
        params: Promise.resolve({ id: ID }),
      }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401, 401]);
    for (const response of responses) {
      expect(await response.json()).toEqual({ error: "Authentication required" });
    }
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("denies admin moderation, reporting, and verification operations before role or data access", async () => {
    const { client, from, rpc } = unauthenticatedClient();
    createClient.mockResolvedValue(client);
    const [
      { POST: moderateReview },
      { GET: readAudit },
      { GET: readAnalytics },
      { GET: listVerifications },
      { POST: decideVerification },
    ] = await Promise.all([
      import("../../src/app/api/v1/admin/reviews/[id]/moderate/route"),
      import("../../src/app/api/v1/admin/audit/route"),
      import("../../src/app/api/v1/admin/analytics/route"),
      import("../../src/app/api/v1/admin/verifications/route"),
      import("../../src/app/api/v1/admin/verifications/[id]/decision/route"),
    ]);

    const responses = await Promise.all([
      moderateReview(jsonRequest(`http://localhost/api/v1/admin/reviews/${ID}/moderate`, { decision: "approved", notes: "Approved for publication." }), {
        params: Promise.resolve({ id: ID }),
      }),
      readAudit(new Request("http://localhost/api/v1/admin/audit?page=1&pageSize=50")),
      readAnalytics(new Request("http://localhost/api/v1/admin/analytics?days=30")),
      listVerifications(new Request("http://localhost/api/v1/admin/verifications?limit=50&offset=0")),
      decideVerification(jsonRequest(`http://localhost/api/v1/admin/verifications/${ID}/decision`, { action: "claim", reviewLevel: 1 }), {
        params: Promise.resolve({ id: ID }),
      }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401]);
    for (const response of responses) {
      expect(await response.json()).toEqual({ error: "Authentication required" });
    }
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
