import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Prerequisites when enabled:
// - every migration through 20260831160500_realtime_operations.sql is applied;
// - OWNER_ONE and OWNER_TWO are distinct authenticated users with profile role "host";
// - ADMIN is an authenticated user with profile role "admin";
// - the publishable key and service-role key target the same disposable test project.
const runIntegration = process.env.RUN_SUPABASE_INTEGRATION === "true";
const integrationDescribe = runIntegration ? describe : describe.skip;

type AccountPrefix = "OWNER_ONE" | "OWNER_TWO" | "ADMIN";
type TestCredentials = { email: string; password: string };
type SupportCase = { id: string; host_id: string | null; customer_id: string | null; status: string };
type Review = {
  id: string;
  booking_id: string;
  guest_id: string;
  property_id: string;
  moderation_status: string;
  is_published: boolean;
  host_response: string | null;
};

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required when RUN_SUPABASE_INTEGRATION=true`);
  return value;
}

function credentials(prefix: AccountPrefix): TestCredentials {
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

integrationDescribe("Phase 4 support and review operations", () => {
  let host: SupabaseClient;
  let guest: SupabaseClient;
  let admin: SupabaseClient;
  let service: SupabaseClient;
  let hostId: string;
  let guestId: string;
  let adminId: string;
  let destinationId: string;
  let propertyId: string | undefined;
  let eligibleBookingId: string | undefined;
  let ineligibleBookingId: string | undefined;
  let supportCaseId: string | undefined;
  let reviewId: string | undefined;

  beforeAll(async () => {
    const [hostAccount, guestAccount, adminAccount] = await Promise.all([
      authenticatedClient(credentials("OWNER_ONE")),
      authenticatedClient(credentials("OWNER_TWO")),
      authenticatedClient(credentials("ADMIN")),
    ]);
    host = hostAccount.client;
    guest = guestAccount.client;
    admin = adminAccount.client;
    hostId = hostAccount.userId;
    guestId = guestAccount.userId;
    adminId = adminAccount.userId;
    expect(new Set([hostId, guestId, adminId]).size).toBe(3);

    service = createClient(
      requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL"),
      requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const [{ data: profiles, error: profileError }, { data: destination, error: destinationError }] = await Promise.all([
      service.from("profiles").select("id,role").in("id", [hostId, guestId, adminId]),
      service.from("destinations").select("id").eq("is_active", true).limit(1).single(),
    ]);
    expect(profileError).toBeNull();
    expect(Object.fromEntries((profiles ?? []).map((profile) => [profile.id, profile.role]))).toMatchObject({
      [hostId]: "host",
      [guestId]: "host",
      [adminId]: "admin",
    });
    expect(destinationError).toBeNull();
    expect(destination).not.toBeNull();
    destinationId = destination!.id;
  }, 30_000);

  afterAll(async () => {
    if (service && supportCaseId) {
      await service.from("notification_outbox").delete().contains("payload", { support_case_id: supportCaseId });
      await service.from("audit_logs").delete().eq("entity_type", "support_case").eq("entity_id", supportCaseId);
      await service.from("support_cases").delete().eq("id", supportCaseId);
    }
    if (service && reviewId) {
      await service.from("notification_outbox").delete().contains("payload", { review_id: reviewId });
      await service.from("audit_logs").delete().eq("entity_type", "review").eq("entity_id", reviewId);
      await service.from("reviews").delete().eq("id", reviewId);
    }
    if (service) {
      const bookingIds = [eligibleBookingId, ineligibleBookingId].filter((id): id is string => Boolean(id));
      if (bookingIds.length > 0) await service.from("bookings").delete().in("id", bookingIds);
      if (propertyId) await service.from("properties").delete().eq("id", propertyId);
    }
    await Promise.all([
      host?.auth.signOut() ?? Promise.resolve(),
      guest?.auth.signOut() ?? Promise.resolve(),
      admin?.auth.signOut() ?? Promise.resolve(),
    ]);
  }, 30_000);

  it("isolates a support case, preserves its message thread, and emits audit/outbox records without sending notifications", async () => {
    const subject = `Phase 4 support ${crypto.randomUUID().slice(0, 8)}`;
    const created = await guest.rpc("create_support_case", {
      p_subject: subject,
      p_message: "This is the private initial integration-test message.",
      p_category: "account",
      p_priority: "normal",
      p_booking_id: null,
    });
    expect(created.error).toBeNull();
    const supportCase = created.data as SupportCase;
    supportCaseId = supportCase.id;
    expect(supportCase).toMatchObject({ host_id: guestId, customer_id: null, status: "open" });

    const [{ data: hiddenCase, error: hiddenCaseError }, { data: hiddenMessages, error: hiddenMessagesError }, deniedReply] = await Promise.all([
      host.from("support_cases").select("id").eq("id", supportCaseId).maybeSingle(),
      host.from("support_case_messages").select("id").eq("support_case_id", supportCaseId),
      host.rpc("add_support_case_message", {
        p_case_id: supportCaseId,
        p_message: "A different account must not enter this conversation.",
        p_internal: false,
      }),
    ]);
    expect(hiddenCaseError).toBeNull();
    expect(hiddenCase).toBeNull();
    expect(hiddenMessagesError).toBeNull();
    expect(hiddenMessages).toEqual([]);
    expect(deniedReply.error?.code).toBe("P0002");

    const reply = await guest.rpc("add_support_case_message", {
      p_case_id: supportCaseId,
      p_message: "Here is a second message from the case owner.",
      p_internal: false,
    });
    expect(reply.error).toBeNull();

    const [{ data: ownerCase, error: ownerCaseError }, { data: ownerMessages, error: ownerMessagesError }] = await Promise.all([
      guest.from("support_cases").select("id,status").eq("id", supportCaseId).single(),
      guest.from("support_case_messages").select("author_id,body,is_internal").eq("support_case_id", supportCaseId).order("created_at"),
    ]);
    expect(ownerCaseError).toBeNull();
    expect(ownerCase?.status).toBe("in_progress");
    expect(ownerMessagesError).toBeNull();
    expect(ownerMessages).toEqual([
      { author_id: guestId, body: "This is the private initial integration-test message.", is_internal: false },
      { author_id: guestId, body: "Here is a second message from the case owner.", is_internal: false },
    ]);

    const [{ data: audit, error: auditError }, { data: outbox, error: outboxError }] = await Promise.all([
      service.from("audit_logs").select("action").eq("entity_type", "support_case").eq("entity_id", supportCaseId).order("id"),
      service.from("notification_outbox").select("template_key,status").contains("payload", { support_case_id: supportCaseId }).order("created_at"),
    ]);
    expect(auditError).toBeNull();
    expect(audit?.map((entry) => entry.action)).toEqual(["created", "message_added"]);
    expect(outboxError).toBeNull();
    expect(outbox?.map((entry) => entry.template_key)).toEqual(["support_case_created", "support_case_customer_reply"]);
    expect(outbox?.every((entry) => entry.status === "pending")).toBe(true);
  }, 45_000);

  it("allows one review only after completion, guards host responses, and records every workflow event", async () => {
    const unique = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const { data: property, error: propertyError } = await service
      .from("properties")
      .insert({
        host_id: hostId,
        destination_id: destinationId,
        slug: `phase4-review-${unique}`,
        name: `Phase 4 Review ${unique}`,
        address_line1: "Integration test fixture",
        max_guests: 2,
        status: "published",
        published_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    expect(propertyError).toBeNull();
    propertyId = property!.id;

    const baseBooking = {
      guest_id: guestId,
      property_id: propertyId,
      check_in: isoDateFromNow(-3),
      check_out: isoDateFromNow(-2),
      guest_count: 2,
      contact_name: "Phase Four Guest",
      contact_email: credentials("OWNER_TWO").email,
      currency_code: "INR",
      subtotal: 2500,
      taxes: 0,
      total_amount: 2500,
      hold_expires_at: null,
    };
    const { data: bookings, error: bookingsError } = await service
      .from("bookings")
      .insert([
        { ...baseBooking, status: "completed", idempotency_key: crypto.randomUUID() },
        { ...baseBooking, status: "confirmed", idempotency_key: crypto.randomUUID() },
      ])
      .select("id,status");
    expect(bookingsError).toBeNull();
    eligibleBookingId = bookings!.find((booking) => booking.status === "completed")!.id;
    ineligibleBookingId = bookings!.find((booking) => booking.status === "confirmed")!.id;

    const ineligible = await guest.rpc("submit_review", {
      p_booking_id: ineligibleBookingId,
      p_rating: 4,
      p_title: "Not completed",
      p_body: "This booking must not be reviewable yet.",
    });
    expect(ineligible.error?.code).toBe("P0001");

    const submitted = await guest.rpc("submit_review", {
      p_booking_id: eligibleBookingId,
      p_rating: 5,
      p_title: "Excellent integration stay",
      p_body: "The completed stay is eligible for exactly one review.",
    });
    expect(submitted.error).toBeNull();
    const review = submitted.data as Review;
    reviewId = review.id;
    expect(review).toMatchObject({
      booking_id: eligibleBookingId,
      guest_id: guestId,
      property_id: propertyId,
      moderation_status: "pending",
      is_published: false,
      host_response: null,
    });

    const duplicate = await guest.rpc("submit_review", {
      p_booking_id: eligibleBookingId,
      p_rating: 3,
      p_title: "Duplicate",
      p_body: "A second review must be rejected for this booking.",
    });
    expect(duplicate.error?.code).toBe("23505");

    const prematureResponse = await host.rpc("respond_to_review", {
      p_review_id: reviewId,
      p_response: "This response must wait for moderation.",
    });
    expect(prematureResponse.error?.code).toBe("P0001");

    const moderation = await admin.rpc("moderate_review", {
      p_review_id: reviewId,
      p_decision: "approved",
      p_notes: "Approved by the Phase 4 integration fixture.",
    });
    expect(moderation.error).toBeNull();
    expect(moderation.data).toMatchObject({ moderation_status: "approved", is_published: true });

    const wrongHostResponse = await guest.rpc("respond_to_review", {
      p_review_id: reviewId,
      p_response: "The guest cannot impersonate the property owner.",
    });
    expect(wrongHostResponse.error?.code).toBe("P0002");

    const response = await host.rpc("respond_to_review", {
      p_review_id: reviewId,
      p_response: "Thank you for staying with us.",
    });
    expect(response.error).toBeNull();
    expect(response.data).toMatchObject({ host_response: "Thank you for staying with us." });

    const secondResponse = await host.rpc("respond_to_review", {
      p_review_id: reviewId,
      p_response: "A second host response must not overwrite the first.",
    });
    expect(secondResponse.error?.code).toBe("23505");

    const [{ data: audit, error: auditError }, { data: outbox, error: outboxError }, { count: reviewCount, error: countError }] = await Promise.all([
      service.from("audit_logs").select("action").eq("entity_type", "review").eq("entity_id", reviewId).order("id"),
      service.from("notification_outbox").select("template_key,status").contains("payload", { review_id: reviewId }).order("created_at"),
      service.from("reviews").select("id", { count: "exact", head: true }).eq("booking_id", eligibleBookingId),
    ]);
    expect(auditError).toBeNull();
    expect(audit?.map((entry) => entry.action)).toEqual(["submitted", "moderated", "host_responded"]);
    expect(outboxError).toBeNull();
    expect(outbox?.map((entry) => entry.template_key)).toEqual([
      "review_submitted_host",
      "review_approved_guest",
      "review_host_response_guest",
    ]);
    expect(outbox?.every((entry) => entry.status === "pending")).toBe(true);
    expect(countError).toBeNull();
    expect(reviewCount).toBe(1);
  }, 60_000);
});
