export { B as BetterAuthFactoryOptions, O as OtpIntent, P as PhonePolicy, c as createAuthRuntime, a as createBetterAuthRuntime, b as createCustomPhonePolicy, d as createOtpIntentRegistry, e as createPhonePolicy, v as validateBetterAuthOptions } from '../runtime-DXxMRz5n.cjs';
import '../contracts-CqPcJqVW.cjs';

type AuthHook = (context: Readonly<Record<string, unknown>>) => void | Promise<void>;
declare function composeAuthHooks(required: readonly AuthHook[], extensions?: readonly AuthHook[]): (context: Readonly<Record<string, unknown>>) => Promise<void>;

declare function parseTestOtpCodes(environment: 'development' | 'test' | 'production', values: Record<string, string> | undefined): Readonly<{
    [x: string]: string;
}>;
declare function matchesTestOtp(expected: string | undefined, actual: string): boolean;

export { type AuthHook, composeAuthHooks, matchesTestOtp, parseTestOtpCodes };
