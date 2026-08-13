import { e as IdentityProof, g as ActiveScope, h as AuthSession, P as ProvisioningDecision, R as RoleRegistry, I as IdentityLinkStore, M as MembershipResolver, i as AuthAuditSink } from './contracts-CqPcJqVW.js';
export { j as AuthAuditEvent, k as AuthClock, l as AuthError, m as AuthErrorCode, n as AuthLogger, A as AuthResult, D as DomainSubject, d as IdentityLink, o as IdentityRateLimiter, p as Membership, O as OtpSender, q as RoleCatalog, f as RoleDefinition, b as RoleRecord, a as RoleStore, c as RoleUpsert, r as defineRoleRegistry } from './contracts-CqPcJqVW.js';
import { z } from 'zod';
export { SynchronizationMode, SynchronizationReport, synchronizeRoles } from './roles/index.js';
export { B as BetterAuthFactoryOptions, O as OtpIntent, P as PhonePolicy, c as createAuthRuntime, a as createBetterAuthRuntime, b as createCustomPhonePolicy, d as createOtpIntentRegistry, e as createPhonePolicy, v as validateBetterAuthOptions } from './runtime-mXlEzACt.js';

declare const authConfigSchema: z.ZodObject<{
    environment: z.ZodEnum<["development", "test", "production"]>;
    sessionTtlSeconds: z.ZodNumber;
    allowFixedTestOtp: z.ZodDefault<z.ZodBoolean>;
}, "strict", z.ZodTypeAny, {
    environment: "development" | "test" | "production";
    sessionTtlSeconds: number;
    allowFixedTestOtp: boolean;
}, {
    environment: "development" | "test" | "production";
    sessionTtlSeconds: number;
    allowFixedTestOtp?: boolean | undefined;
}>;
type AuthConfig = z.infer<typeof authConfigSchema>;
declare function parseAuthConfig(input: unknown): Readonly<AuthConfig>;

type AuthenticatedPrincipal<RoleKey extends string = string> = Readonly<{
    authUserId: string;
    subjectId: string;
    role: RoleKey;
    permissions: readonly string[];
    readOnly: boolean;
    identityProofs: readonly IdentityProof[];
    activeScope?: ActiveScope;
    session: Pick<AuthSession, 'id' | 'issuedAt' | 'expiresAt'>;
}>;
declare function freezePrincipal<R extends string>(principal: AuthenticatedPrincipal<R>): AuthenticatedPrincipal<R>;

declare function verifiedProofs(input: {
    email?: {
        value: string;
        verified: boolean;
    };
    phone?: {
        value: string;
        verified: boolean;
    };
}, normalizePhone?: (value: string) => string): readonly IdentityProof[];

declare function provisionIdentity(input: {
    authUserId: string;
    proofs: readonly IdentityProof[];
    decision: ProvisioningDecision;
    registry: RoleRegistry<any>;
    store: IdentityLinkStore;
}): Promise<{
    subjectId: string;
}>;

declare function resolvePrincipal(input: {
    authUserId: string;
    session: AuthSession;
    role?: string;
    registry: RoleRegistry<any>;
    identities: IdentityLinkStore;
    memberships: MembershipResolver;
    audit?: AuthAuditSink;
}): Promise<AuthenticatedPrincipal>;

declare const FLOWKIT_AUTH_VERSION = "0.1.0";

export { ActiveScope, AuthAuditSink, type AuthConfig, AuthSession, type AuthenticatedPrincipal, FLOWKIT_AUTH_VERSION, IdentityLinkStore, IdentityProof, MembershipResolver, ProvisioningDecision, RoleRegistry, authConfigSchema, freezePrincipal, parseAuthConfig, provisionIdentity, resolvePrincipal, verifiedProofs };
