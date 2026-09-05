import { z } from "zod";

export const bookingHoldSchema = z.object({
  propertyId: z.uuid(),
  roomId: z.uuid(),
  contactName: z.string().trim().min(1).max(120),
  contactEmail: z.email(),
  contactPhone: z.string().trim().min(6).max(30).optional(),
  checkIn: z.coerce.date(),
  checkOut: z.coerce.date(),
  guests: z.coerce.number().int().min(1).max(20),
  idempotencyKey: z.uuid(),
}).superRefine((value, context) => {
  if (value.checkOut <= value.checkIn) {
    context.addIssue({ code: "custom", message: "Check-out must be after check-in.", path: ["checkOut"] });
  }
  if (value.checkIn < new Date(new Date().toDateString())) {
    context.addIssue({ code: "custom", message: "Check-in cannot be in the past.", path: ["checkIn"] });
  }
});

export type BookingHoldInput = z.infer<typeof bookingHoldSchema>;
