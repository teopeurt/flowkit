import { validateBetterAuthOptions, type BetterAuthFactoryOptions } from './config';
export function createAuthRuntime(options: BetterAuthFactoryOptions) { const config = validateBetterAuthOptions(options); return Object.freeze({ config, enabled: config.enabled, getOptions: () => config }); }
export const createBetterAuthRuntime = createAuthRuntime;
