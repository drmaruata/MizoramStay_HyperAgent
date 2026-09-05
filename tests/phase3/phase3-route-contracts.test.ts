import { beforeEach, describe, expect, it, vi } from "vitest";

const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/validation/phase3-booking", async () => import("../../src/lib/validation/phase3-booking"));

const BOOKING_ID = "11111111-1111-4111-8111-111111111111";

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function unauthenticatedClient() {
  const from = vi.fn();
  const rpc = vi.fn();
  const invoke = vi.fn();
  return {
    client: {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
      from,
      rpc,
      functions: { invoke },
    },
    from,
    rpc,
    invoke,
  };
}

describe("Phase 3 route validation contracts", () => {
  beforeEach(() => createClient.mockReset());

  it("rejects malformed booking IDs before creating a database client", async () => {
    const [{ GET }, { POST: cancelBooking }, { POST: createOrder }] = await Promise.all([
      import("../../src/app/api/v1/bookings/[id]/route"),
      import("../../src/app/api/v1/bookings/[id]/cancel/route"),
      import("../../src/app/api/v1/payments/orders/route"),
    ]);

    const [readResponse, cancelResponse, orderResponse] = await Promise.all([
      GET(new Request("http://localhost/api/v1/bookings/not-a-uuid"), {
        params: Promise.resolve({ id: "not-a-uuid" }),
      }),
      cancelBooking(
        jsonRequest("http://localhost/api/v1/bookings/not-a-uuid/cancel", { reason: "A valid cancellation reason" }),
        { params: Promise.resolve({ id: "not-a-uuid" }) },
      ),
      createOrder(jsonRequest("http://localhost/api/v1/payments/orders", { bookingId: "not-a-uuid" })),
    ]);

    expect(readResponse.status).toBe(400);
    expect(await readResponse.json()).toEqual({ error: "Invalid booking id" });
    expect(cancelResponse.status).toBe(400);
    expect(await cancelResponse.json()).toEqual({ error: "Invalid booking id" });
    expect(orderResponse.status).toBe(400);
    expect(await orderResponse.json()).toMatchObject({ error: "Invalid payment order request" });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects malformed cancellation JSON and reasons before authentication", async () => {
    const { POST } = await import("../../src/app/api/v1/bookings/[id]/cancel/route");
    const malformedJson = new Request(`http://localhost/api/v1/bookings/${BOOKING_ID}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });

    const responses = await Promise.all([
      POST(malformedJson, { params: Promise.resolve({ id: BOOKING_ID }) }),
      POST(
        jsonRequest(`http://localhost/api/v1/bookings/${BOOKING_ID}/cancel`, { reason: "too short" }),
        { params: Promise.resolve({ id: BOOKING_ID }) },
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([400, 400]);
    expect(await Promise.all(responses.map((response) => response.json()))).toEqual([
      expect.objectContaining({ error: "Invalid cancellation request" }),
      expect.objectContaining({ error: "Invalid cancellation request" }),
    ]);
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe("Phase 3 unauthenticated route contracts", () => {
  beforeEach(() => createClient.mockReset());

  it("denies booking reads without querying booking data", async () => {
    const { client, from } = unauthenticatedClient();
    createClient.mockResolvedValue(client);
    const { GET } = await import("../../src/app/api/v1/bookings/[id]/route");

    const response = await GET(new Request(`http://localhost/api/v1/bookings/${BOOKING_ID}`), {
      params: Promise.resolve({ id: BOOKING_ID }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required" });
    expect(from).not.toHaveBeenCalled();
  });

  it("denies booking cancellation without reading or mutating booking data", async () => {
    const { client, from, rpc } = unauthenticatedClient();
    createClient.mockResolvedValue(client);
    const { POST } = await import("../../src/app/api/v1/bookings/[id]/cancel/route");

    const response = await POST(
      jsonRequest(`http://localhost/api/v1/bookings/${BOOKING_ID}/cancel`, {
        reason: "My travel dates have changed.",
      }),
      { params: Promise.resolve({ id: BOOKING_ID }) },
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required" });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("denies payment-order creation without reading a booking or invoking payment infrastructure", async () => {
    const { client, from, invoke } = unauthenticatedClient();
    createClient.mockResolvedValue(client);
    const { POST } = await import("../../src/app/api/v1/payments/orders/route");

    const response = await POST(jsonRequest("http://localhost/api/v1/payments/orders", { bookingId: BOOKING_ID }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required" });
    expect(from).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
