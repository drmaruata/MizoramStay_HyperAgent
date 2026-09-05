import { z } from "zod";

const dateSchema = z.iso.date();
const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, "Currency code must be a three-letter uppercase ISO code.");

export const roomCreateSchema = z.object({
  propertyId: z.uuid(),
  name: z.string().trim().min(1).max(180),
  description: z.string().trim().max(10_000).optional(),
  capacityAdults: z.number().int().min(1).max(1_000),
  capacityChildren: z.number().int().min(0).max(1_000).optional(),
  bedsDescription: z.string().trim().max(500).optional(),
  baseNightlyRate: z.number().finite().min(0).max(99_999_999.99),
  currencyCode: currencyCodeSchema.optional(),
  isActive: z.boolean().optional(),
});

export const inventoryUpsertSchema = z.object({
  roomId: z.uuid(),
  startDate: dateSchema,
  endDate: dateSchema,
  availableUnits: z.number().finite().int().min(0).max(1_000_000),
  nightlyRate: z.number().finite().min(0).max(99_999_999.99),
  currencyCode: currencyCodeSchema.optional(),
  minimumNights: z.number().finite().int().positive().max(365).optional(),
  closedToArrival: z.boolean().optional(),
  closedToDeparture: z.boolean().optional(),
}).superRefine((value, context) => {
  const today = new Date().toISOString().slice(0, 10);

  if (value.startDate < today) {
    context.addIssue({ code: "custom", message: "Start date cannot be in the past.", path: ["startDate"] });
  }
  if (value.endDate < value.startDate) {
    context.addIssue({ code: "custom", message: "End date must be on or after start date.", path: ["endDate"] });
  }
});

export type RoomCreateInput = z.infer<typeof roomCreateSchema>;
export type InventoryUpsertInput = z.infer<typeof inventoryUpsertSchema>;
