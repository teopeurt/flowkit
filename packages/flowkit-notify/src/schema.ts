import { z } from 'zod';
import type { JsonValue } from './contracts.js';

const jsonPrimitive = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([jsonPrimitive, z.array(jsonValueSchema), z.record(jsonValueSchema)]),
);

const key = z.string().trim().min(1).max(200);
const uniqueStrings = z.array(key).min(1).refine((values) => new Set(values).size === values.length, 'values must be unique');

export const routeSchema = z.object({
  channel: key,
  canonicalKey: key,
  address: z.string().trim().min(1),
  enabled: z.boolean().optional(),
  metadata: z.record(jsonValueSchema).optional(),
}).strict();

export const recipientSchema = z.object({
  key,
  label: z.string().optional(),
  templateData: jsonValueSchema.optional(),
  routes: z.array(routeSchema).min(1),
}).strict();

export const selectorSchema = z.object({ key, data: jsonValueSchema.optional() }).strict();

export const requestSchema = z.object({
  namespace: key,
  sourceKey: key,
  aggregate: z.object({ type: key, id: key }).strict(),
  templateKey: key,
  data: jsonValueSchema,
  channels: uniqueStrings,
  selectors: z.array(selectorSchema).optional(),
  explicitRecipients: z.array(recipientSchema).optional(),
  metadata: z.record(jsonValueSchema).optional(),
}).strict().refine((value) => (value.selectors?.length ?? 0) > 0 || (value.explicitRecipients?.length ?? 0) > 0, {
  message: 'at least one selector or explicit recipient is required',
});

export const renderedSchema = z.object({
  subject: z.string().trim().min(1),
  body: z.string().trim().min(1),
  severity: z.enum(['info', 'success', 'warning', 'error']).optional(),
  actions: z.array(z.object({ label: z.string().trim().min(1), url: z.string().trim().min(1) }).strict()).optional(),
  metadata: z.record(jsonValueSchema).optional(),
}).strict();

export const retryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1),
  initialDelayMs: z.number().int().min(0),
  multiplier: z.number().finite().min(1),
  maxDelayMs: z.number().int().min(0),
  maxRetryWindowMs: z.number().int().min(0).optional(),
}).strict();

export const envelopeSchema = z.object({
  namespace: key,
  sourceKey: key,
  aggregate: z.object({ type: key, id: key }).strict(),
  templateKey: key,
  channel: key,
  recipient: routeSchema,
  rendered: renderedSchema,
  dedupeKey: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  payloadFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  requestFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  retryPolicy: retryPolicySchema,
  metadata: z.record(jsonValueSchema),
}).strict();

export type RequestInput = z.infer<typeof requestSchema>;
