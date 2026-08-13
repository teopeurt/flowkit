import { R as RoleRegistry, A as AuthResult } from './contracts-CqPcJqVW.cjs';

type PhonePolicy = Readonly<{
    normalize(value: string): string;
    isValid(value: string): boolean;
}>;
declare function createPhonePolicy(input: {
    callingCode: string;
    trunkPrefix?: string;
    nationalNumber: RegExp;
}): PhonePolicy;
declare function createCustomPhonePolicy(normalize: (value: string) => string, isValid: (value: string) => boolean): PhonePolicy;

type BetterAuthFactoryOptions = {
    database: unknown;
    secret: string;
    baseURL: string;
    basePath?: string;
    trustedOrigins: readonly string[];
    roleRegistry: RoleRegistry<any>;
    phonePolicy?: PhonePolicy;
    environment?: 'development' | 'test' | 'production';
    enabled?: boolean;
};
declare function validateBetterAuthOptions(options: BetterAuthFactoryOptions): Readonly<{
    basePath: string;
    enabled: boolean;
    database: unknown;
    secret: string;
    baseURL: string;
    trustedOrigins: readonly string[];
    roleRegistry: RoleRegistry<any>;
    phonePolicy?: PhonePolicy;
    environment?: "development" | "test" | "production";
}>;

type OtpIntent = {
    readonly name: string;
    readonly authorize: (input: {
        identity: string;
        context: Readonly<Record<string, unknown>>;
    }) => Promise<{
        allowed: boolean;
        reason: string;
    }> | {
        allowed: boolean;
        reason: string;
    };
};
declare function createOtpIntentRegistry(intents: readonly OtpIntent[]): Readonly<{
    authorize(input: {
        intent: string;
        identity: string;
        context?: Readonly<Record<string, unknown>>;
    }): Promise<AuthResult<{
        reason: string;
    }>>;
}>;

declare function createAuthRuntime(options: BetterAuthFactoryOptions): Readonly<{
    config: Readonly<{
        basePath: string;
        enabled: boolean;
        database: unknown;
        secret: string;
        baseURL: string;
        trustedOrigins: readonly string[];
        roleRegistry: RoleRegistry<any>;
        phonePolicy?: PhonePolicy;
        environment?: "development" | "test" | "production";
    }>;
    enabled: boolean;
    getOptions: () => Readonly<{
        basePath: string;
        enabled: boolean;
        database: unknown;
        secret: string;
        baseURL: string;
        trustedOrigins: readonly string[];
        roleRegistry: RoleRegistry<any>;
        phonePolicy?: PhonePolicy;
        environment?: "development" | "test" | "production";
    }>;
}>;
declare const createBetterAuthRuntime: typeof createAuthRuntime;

export { type BetterAuthFactoryOptions as B, type OtpIntent as O, type PhonePolicy as P, createBetterAuthRuntime as a, createCustomPhonePolicy as b, createAuthRuntime as c, createOtpIntentRegistry as d, createPhonePolicy as e, validateBetterAuthOptions as v };
