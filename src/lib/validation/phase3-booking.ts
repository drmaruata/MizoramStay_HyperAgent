import { z } from "zod";

export const bookingIdSchema = z.uuid("Invalid booking id");

export const paymentOrderSchema = z.object({
  bookingId: bookingIdSchema,
}).strict();

export const cancelBookingSchema = z.object({
  reason: z.string()
    .trim()
    .min(10, "Please provide at least 10 characters so we can understand the cancellation.")
    .max(500, "Cancellation reason must be 500 characters or fewer."),
}).strict();

export const paymentOrderResponseSchema = z.object({
  orderId: z.string().min(1).max(200),
  keyId: z.string().min(1).max(200),
  amount: z.number().int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

export type PaymentOrderInput = z.infer<typeof paymentOrderSchema>;
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;
