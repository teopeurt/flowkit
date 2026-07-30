export { B as BetterAuthFactoryOptions, O as OtpIntent, P as PhonePolicy, c as createAuthRuntime, a as createBetterAuthRuntime, d as createCustomPhonePolicy, e as createOtpIntentRegistry, b as createPhonePolicy, v as validateBetterAuthOptions } from '../otp-intents-BhsI74fR.js';
import '../registry-mLTfQxoY.js';

type AuthHook = (context: Readonly<Record<string, unknown>>) => void | Promise<void>;
declare function composeAuthHooks(required: readonly AuthHook[], extensions?: readonly AuthHook[]): (context: Readonly<Record<string, unknown>>) => Promise<void>;

declare function parseTestOtpCodes(environment: 'development' | 'test' | 'production', values: Record<string, string> | undefined): Readonly<{
    [x: string]: string;
}>;
declare function matchesTestOtp(expected: string | undefined, actual: string): boolean;

export { type AuthHook, composeAuthHooks, matchesTestOtp, parseTestOtpCodes };
