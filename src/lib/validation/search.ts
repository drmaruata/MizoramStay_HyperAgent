import { z } from "zod";

export const MAX_SEARCH_STAY_NIGHTS = 30;
export const MAX_SEARCH_GUESTS = 20;
export const MAX_SEARCH_RESULTS = 100;

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD format.").refine((value) => {
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}, "Date must be a valid calendar date.");

export const availabilitySearchSchema = z.object({
  destination: z.string().trim().max(80).default(""),
  checkIn: isoDateSchema,
  checkOut: isoDateSchema,
  guests: z.coerce.number().int().min(1).max(MAX_SEARCH_GUESTS),
  limit: z.coerce.number().int().min(1).max(MAX_SEARCH_RESULTS).default(30),
}).strict().superRefine((value, context) => {
  const today = new Date().toISOString().slice(0, 10);

  if (value.checkIn < today) {
    context.addIssue({ code: "custom", message: "Check-in cannot be in the past.", path: ["checkIn"] });
  }
  if (value.checkOut <= value.checkIn) {
    context.addIssue({ code: "custom", message: "Check-out must be after check-in.", path: ["checkOut"] });
    return;
  }

  const checkIn = Date.parse(`${value.checkIn}T00:00:00.000Z`);
  const checkOut = Date.parse(`${value.checkOut}T00:00:00.000Z`);
  const nights = (checkOut - checkIn) / 86_400_000;
  if (nights > MAX_SEARCH_STAY_NIGHTS) {
    context.addIssue({
      code: "custom",
      message: `Stay cannot exceed ${MAX_SEARCH_STAY_NIGHTS} nights.`,
      path: ["checkOut"],
    });
  }
});

export type AvailabilitySearchInput = z.infer<typeof availabilitySearchSchema>;
