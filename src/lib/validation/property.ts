import { z } from "zod";

const slugSchema = z.string().trim().min(2).max(180).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must use lowercase kebab-case.");
const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Time must use HH:MM format.");

export const propertyCreateSchema = z.object({
  destinationId: z.uuid(),
  slug: slugSchema,
  name: z.string().trim().min(2).max(180),
  summary: z.string().trim().max(500).optional(),
  description: z.string().trim().max(10_000).optional(),
  addressLine1: z.string().trim().min(1).max(300),
  addressLine2: z.string().trim().max(300).optional(),
  locality: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().max(20).optional(),
  latitude: z.number().finite().min(-90).max(90).optional(),
  longitude: z.number().finite().min(-180).max(180).optional(),
  checkInTime: timeSchema.optional(),
  checkOutTime: timeSchema.optional(),
  maxGuests: z.number().int().min(1).max(1_000).optional(),
}).superRefine((value, context) => {
  if (value.checkInTime && value.checkOutTime && value.checkInTime === value.checkOutTime) {
    context.addIssue({ code: "custom", message: "Check-in and check-out times must differ.", path: ["checkOutTime"] });
  }
});

export type PropertyCreateInput = z.infer<typeof propertyCreateSchema>;
