import { z } from "zod";

const maxUploadBytes = 10 * 1024 * 1024;

const fileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => !/[\\/\0]/.test(value), "File name must not contain path separators.");

const uploadRequestSchema = z.object({
  propertyId: z.uuid(),
  fileName: fileNameSchema,
  contentType: z.string().trim(),
  fileSize: z.number().int().positive().max(maxUploadBytes),
}).strict();

export const propertyMediaUploadSchema = uploadRequestSchema.extend({
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});

export const propertyDocumentUploadSchema = uploadRequestSchema.extend({
  contentType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
});

export type PropertyMediaUploadInput = z.infer<typeof propertyMediaUploadSchema>;
export type PropertyDocumentUploadInput = z.infer<typeof propertyDocumentUploadSchema>;
