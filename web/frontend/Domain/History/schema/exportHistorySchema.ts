// web/frontend/Domain/History/schemas/exportHistorySchema.ts
import { z } from 'zod';

const StatusSummarySchema = z.object({
  key: z.string(),
  label: z.string(),
  tone: z.string().optional(),
  detail: z.string().nullable().optional(),
  isTerminal: z.boolean().optional(),
});

const ErrorEntrySchema = z.object({
  code: z.string().optional(),
  stage: z.string().optional(),
  message: z.string().optional(),
  retryable: z.boolean().optional(),
  details: z.unknown().optional(),
  occurredAt: z.string().optional(),
});

// Schema for a single export history item
export const ExportHistoryItemSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  filename: z.string().optional(),
  status: z.string().optional(),
  executionState: z.string().optional(),
  failureStage: z.string().nullable().optional(),
  type: z.string().optional(),
  totalItems: z.number().optional().default(0),
  targetSnapshotCount: z.number().optional().default(0),
  processedCount: z.number().optional().default(0),
  exportTime: z.union([z.string(), z.date()]).optional(),
  fileUrl: z.string().nullable().optional(),
  createdAt: z.union([z.string(), z.date()]).optional(),
  completedAt: z.union([z.string(), z.date()]).optional(),
  progressPercent: z.number().optional(),
  primaryStatus: StatusSummarySchema.optional(),
  progressSummary: z
    .object({
      current: z.number().optional(),
      total: z.number().optional(),
      percent: z.number().optional(),
      label: z.string().optional(),
    })
    .optional(),
  supportStatus: z
    .object({
      executionState: z.string().nullable().optional(),
      failureStage: z.string().nullable().optional(),
      targetSnapshotCount: z.number().optional(),
      targetMirrorBatchId: z.string().nullable().optional(),
      errors: z.array(ErrorEntrySchema).optional(),
      lastError: ErrorEntrySchema.nullable().optional(),
    })
    .optional(),
});

// Schema for the complete API response
export const ExportHistoryResponseSchema = z.array(ExportHistoryItemSchema);

// TypeScript types derived from the schemas
export type ExportHistoryItem = z.infer<typeof ExportHistoryItemSchema>;
export type ExportHistoryResponse = z.infer<typeof ExportHistoryResponseSchema>;
