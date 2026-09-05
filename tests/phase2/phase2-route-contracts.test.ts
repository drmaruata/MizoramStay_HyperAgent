import { beforeEach, describe, expect, it, vi } from "vitest";

const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient }));
// The application has no Vitest alias configuration; bridge route-local aliases to
// the real schema modules so these tests can exercise the route validation boundary.
vi.mock("@/lib/validation/property", async () => import("../../src/lib/validation/property"));
vi.mock("@/lib/validation/room", async () => import("../../src/lib/validation/room"));
vi.mock("@/lib/validation/upload", async () => import("../../src/lib/validation/upload"));

const ID = "11111111-1111-4111-8111-111111111111";

function request(url: string, body?: unknown) {
  return new Request(url, body === undefined ? undefined : {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Phase 2 host endpoint contracts before database access", () => {
  beforeEach(() => createClient.mockReset());

  it("returns 400 validation contracts for malformed property, room, inventory, and upload requests", async () => {
    const [{ POST: postProperty }, { POST: postRoom }, { POST: postInventory }, { POST: postMedia }, { POST: postDocument }] = await Promise.all([
      import("../../src/app/api/v1/host/properties/route"),
      import("../../src/app/api/v1/host/rooms/route"),
      import("../../src/app/api/v1/host/inventory/route"),
      import("../../src/app/api/v1/host/media/upload-url/route"),
      import("../../src/app/api/v1/host/documents/upload-url/route"),
    ]);

    const responses = await Promise.all([
      postProperty(request("http://localhost/api/v1/host/properties", { destinationId: ID, slug: "Bad Slug" })),
      postRoom(request("http://localhost/api/v1/host/rooms", { propertyId: ID, name: "", capacityAdults: 0, baseNightlyRate: -1 })),
      postInventory(request("http://localhost/api/v1/host/inventory", { roomId: ID, startDate: "not-a-date" })),
      postMedia(request("http://localhost/api/v1/host/media/upload-url", { propertyId: ID, fileName: "../bad.jpg", contentType: "image/jpeg", fileSize: 1 })),
      postDocument(request("http://localhost/api/v1/host/documents/upload-url", { propertyId: ID, fileName: "proof.webp", contentType: "image/webp", fileSize: 1 })),
    ]);

    expect(await Promise.all(responses.map((response) => response.status))).toEqual([400, 400, 400, 400, 400]);
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe("Phase 2 property submission readiness contract", () => {
  beforeEach(() => createClient.mockReset());

  it("rejects malformed property IDs before authentication/database access", async () => {
    const { POST } = await import("../../src/app/api/v1/host/properties/[id]/submit/route");
    const response = await POST(request("http://localhost/api/v1/host/properties/not-a-uuid/submit"), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid property id" });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("maps the readiness RPC failure to the documented 422 response", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "P0001" } });
    createClient.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "host-1" } } }) }, rpc });
    const { POST } = await import("../../src/app/api/v1/host/properties/[id]/submit/route");

    const response = await POST(request(`http://localhost/api/v1/host/properties/${ID}/submit`), {
      params: Promise.resolve({ id: ID }),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "Property is not ready for submission" });
    expect(rpc).toHaveBeenCalledWith("submit_property_for_review", { p_property_id: ID });
  });
});
