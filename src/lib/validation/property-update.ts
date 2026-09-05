import { z } from "zod";

const slugSchema = z.string().trim().min(2).max(180).regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  "Slug must use lowercase kebab-case.",
);
const timeSchema = z.string().regex(
  /^(?:[01]\d|2[0-3]):[0-5]\d$/,
  "Time must use HH:MM format.",
);
const nullableTrimmedString = (maximum: number) => z.string().trim().max(maximum).nullable();
const fileSizeSchema = z.number().int().positive().max(10 * 1024 * 1024);
const storagePathSchema = z.string().trim().min(1).max(1024).refine(
  (value) => {
    if (value.startsWith("/") || value.includes("\\") || value.includes("\0") || /^https?:\/\//i.test(value)) return false;
    const segments = value.split("/");
    return segments.length === 3 && segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
  },
  "Storage path must be a relative user/property/object path.",
);

export const propertyIdSchema = z.uuid();

export const propertyUpdateSchema = z.object({
  destinationId: z.uuid().optional(),
  slug: slugSchema.optional(),
  name: z.string().trim().min(2).max(180).optional(),
  summary: nullableTrimmedString(500).optional(),
  description: nullableTrimmedString(10_000).optional(),
  addressLine1: z.string().trim().min(1).max(300).optional(),
  addressLine2: nullableTrimmedString(300).optional(),
  locality: nullableTrimmedString(120).optional(),
  postalCode: nullableTrimmedString(20).optional(),
  latitude: z.number().finite().min(-90).max(90).nullable().optional(),
  longitude: z.number().finite().min(-180).max(180).nullable().optional(),
  checkInTime: timeSchema.optional(),
  checkOutTime: timeSchema.optional(),
  maxGuests: z.number().int().min(1).max(1_000).optional(),
}).strict().superRefine((value, context) => {
  if (Object.keys(value).length === 0) {
    context.addIssue({ code: "custom", message: "At least one editable field is required." });
  }
  if (value.checkInTime && value.checkOutTime && value.checkInTime === value.checkOutTime) {
    context.addIssue({ code: "custom", message: "Check-in and check-out times must differ.", path: ["checkOutTime"] });
  }
});

export const propertyAmenitiesReplaceSchema = z.object({
  amenityIds: z.array(z.uuid()).max(200),
}).strict().superRefine((value, context) => {
  if (new Set(value.amenityIds).size !== value.amenityIds.length) {
    context.addIssue({ code: "custom", message: "Amenity ids must be unique.", path: ["amenityIds"] });
  }
});

export const propertyMediaCompleteSchema = z.object({
  propertyId: z.uuid(),
  path: storagePathSchema,
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  fileSize: fileSizeSchema,
  altText: z.string().trim().max(500).nullable().optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
  isCover: z.boolean().optional(),
}).strict();

export const propertyDocumentCompleteSchema = z.object({
  propertyId: z.uuid(),
  path: storagePathSchema,
  contentType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
  fileSize: fileSizeSchema,
  documentType: z.string().trim().min(2).max(80).regex(
    /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/,
    "Document type must use lowercase words separated by hyphens or underscores.",
  ),
  expiresOn: z.iso.date().nullable().optional(),
}).strict();

export type PropertyUpdateInput = z.infer<typeof propertyUpdateSchema>;
export type PropertyAmenitiesReplaceInput = z.infer<typeof propertyAmenitiesReplaceSchema>;
export type PropertyMediaCompleteInput = z.infer<typeof propertyMediaCompleteSchema>;
export type PropertyDocumentCompleteInput = z.infer<typeof propertyDocumentCompleteSchema>;
