import { z } from 'zod';

export const authConfigSchema = z.object({
  environment: z.enum(['development', 'test', 'production']),
  sessionTtlSeconds: z.number().int().min(60).max(31_536_000),
  allowFixedTestOtp: z.boolean().default(false),
}).strict();
export type AuthConfig = z.infer<typeof authConfigSchema>;
export function parseAuthConfig(input: unknown): Readonly<AuthConfig> {
  const result = authConfigSchema.safeParse(input);
  if (!result.success) throw new Error(`Invalid auth configuration: ${result.error.issues.map(issue => issue.path.join('.') || 'root').join(', ')}`);
  if (result.data.environment === 'production' && result.data.allowFixedTestOtp) throw new Error('Fixed OTP codes are not allowed in production');
  return Object.freeze(result.data);
}
