import { z } from "zod";

export const supportCaseIdSchema = z.uuid("Invalid support case id");

export const supportCasePrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
export const supportCaseStatusSchema = z.enum([
  "open",
  "in_progress",
  "waiting_on_customer",
  "resolved",
  "closed",
]);
export const supportCaseCategorySchema = z.enum([
  "booking",
  "payment",
  "property",
  "account",
  "safety",
  "other",
]);

const supportSubjectSchema = z.string()
  .trim()
  .min(5, "Subject must be at least 5 characters.")
  .max(160, "Subject must be 160 characters or fewer.");

const supportMessageSchema = z.string()
  .trim()
  .min(1, "Message is required.")
  .max(4000, "Message must be 4,000 characters or fewer.");

export const createSupportCaseSchema = z.object({
  subject: supportSubjectSchema,
  message: supportMessageSchema,
  category: supportCaseCategorySchema,
  priority: supportCasePrioritySchema.default("normal"),
  bookingId: z.uuid("Invalid booking id").nullable().optional(),
}).strict();

export const supportCaseListQuerySchema = z.object({
  status: supportCaseStatusSchema.optional(),
  priority: supportCasePrioritySchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
}).strict();

const addMessageSchema = z.object({
  action: z.literal("message"),
  message: supportMessageSchema,
  internal: z.boolean().default(false),
}).strict();

const assignCaseSchema = z.object({
  action: z.literal("assign"),
  assigneeId: z.uuid("Invalid assignee id").nullable().optional(),
  priority: supportCasePrioritySchema.optional(),
}).strict();

const resolveCaseSchema = z.object({
  action: z.literal("resolve"),
  resolution: z.string()
    .trim()
    .min(10, "Resolution must be at least 10 characters.")
    .max(2000, "Resolution must be 2,000 characters or fewer."),
}).strict();

export const supportCaseActionSchema = z.discriminatedUnion("action", [
  addMessageSchema,
  assignCaseSchema,
  resolveCaseSchema,
]);

// Named aliases make the message and list boundaries easy to reuse independently.
export const supportCaseMessageSchema = addMessageSchema;
export const supportListQuerySchema = supportCaseListQuerySchema;

export type CreateSupportCaseInput = z.infer<typeof createSupportCaseSchema>;
export type SupportCaseActionInput = z.infer<typeof supportCaseActionSchema>;
export type SupportCaseListQuery = z.infer<typeof supportCaseListQuerySchema>;
