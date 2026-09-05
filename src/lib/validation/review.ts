import { z } from "zod";

export const reviewIdSchema = z.uuid("Invalid review id");
export const reviewBookingIdSchema = z.uuid("Invalid booking id");

const optionalReviewTitleSchema = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).max(120).optional(),
);

export const reviewSubmissionSchema = z.object({
  bookingId: reviewBookingIdSchema,
  rating: z.number().int().min(1, "Rating must be between 1 and 5.").max(5, "Rating must be between 1 and 5."),
  title: optionalReviewTitleSchema,
  body: z.string()
    .trim()
    .min(10, "Review must be at least 10 characters.")
    .max(2000, "Review must be 2000 characters or fewer."),
}).strict();

export const reviewResponseSchema = z.object({
  response: z.string()
    .trim()
    .min(2, "Response must be at least 2 characters.")
    .max(2000, "Response must be 2000 characters or fewer."),
}).strict();

export const createReviewSchema = reviewSubmissionSchema;
export const hostResponseSchema = reviewResponseSchema;

export type ReviewSubmissionInput = z.infer<typeof reviewSubmissionSchema>;
export type ReviewResponseInput = z.infer<typeof reviewResponseSchema>;
