import { z } from "zod";

export const verificationStatusSchema = z.enum([
  "submitted",
  "in_review",
  "changes_requested",
  "approved",
  "rejected",
]);

export const verificationRequestIdSchema = z.uuid();

const reviewLevelSchema = z.coerce.number().int().min(0).max(5);
const optionalReviewLevelQuerySchema = z.preprocess(
  (value) => (value === "" ? Number.NaN : value),
  reviewLevelSchema.optional(),
);

export const verificationListQuerySchema = z.object({
  status: verificationStatusSchema.optional(),
  reviewLevel: optionalReviewLevelQuerySchema,
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
}).strict();

const changeRequestSchema = z.object({
  fieldName: z.string().trim().min(1).max(120),
  instruction: z.string().trim().min(1).max(1000),
}).strict();

const claimSchema = z.object({
  action: z.literal("claim"),
  reviewLevel: reviewLevelSchema.optional(),
}).strict();

const decideSchema = z.object({
  action: z.literal("decide"),
  decision: z.enum(["changes_requested", "approved", "rejected"]),
  reviewLevel: reviewLevelSchema,
  notes: z.string().trim().min(1).max(4000).optional(),
  changeRequests: z.array(changeRequestSchema).max(25).default([]),
}).strict();

export const verificationDecisionSchema = z.discriminatedUnion("action", [
  claimSchema,
  decideSchema,
]).superRefine((value, context) => {
  if (value.action !== "decide") return;

  if (value.decision === "changes_requested") {
    if (!value.notes) {
      context.addIssue({
        code: "custom",
        message: "Review notes are required when requesting changes.",
        path: ["notes"],
      });
    }
    if (value.changeRequests.length === 0) {
      context.addIssue({
        code: "custom",
        message: "At least one change request is required.",
        path: ["changeRequests"],
      });
    }
  }

  if (value.decision === "rejected" && !value.notes) {
    context.addIssue({
      code: "custom",
      message: "Review notes are required when rejecting a request.",
      path: ["notes"],
    });
  }

  if (value.decision !== "changes_requested" && value.changeRequests.length > 0) {
    context.addIssue({
      code: "custom",
      message: "Change requests are only valid for a changes_requested decision.",
      path: ["changeRequests"],
    });
  }
});

export type VerificationListQuery = z.infer<typeof verificationListQuerySchema>;
export type VerificationDecisionInput = z.infer<typeof verificationDecisionSchema>;
