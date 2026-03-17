// web/frontend/Domain/History/schemas/exportHistorySchema.ts
import { z } from 'zod';

// Schema for a single export history item
export const ExportHistoryItemSchema = z.object({
  _id: z.string(),
  filename: z.string().optional(),
  status: z.string().optional(),
  type: z.string().optional(),
  totalItems: z.number().optional().default(0),
  processedCount: z.number().optional().default(0),
  exportTime: z.union([z.string(), z.date()]).optional(),
});

// Schema for the complete API response
export const ExportHistoryResponseSchema = z.array(ExportHistoryItemSchema);

// TypeScript types derived from the schemas
export type ExportHistoryItem = z.infer<typeof ExportHistoryItemSchema>;
export type ExportHistoryResponse = z.infer<typeof ExportHistoryResponseSchema>;