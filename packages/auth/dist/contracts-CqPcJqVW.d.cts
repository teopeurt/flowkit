type RoleDefinition = {
    label: string;
    description?: string;
    aliases?: readonly string[];
    permissions: readonly string[];
    scopes: readonly string[];
    kind: 'internal' | 'external' | 'system';
    provisioning: 'self_service' | 'invite_only' | 'disabled';
    readOnly?: boolean;
    sessionTtlSeconds?: number;
};
type RoleCatalog = Record<string, RoleDefinition>;
type RoleRegistry<C extends RoleCatalog> = Readonly<{
    definitions: Readonly<C>;
    normalizeRole(role: string): string | undefined;
    getRole(role: string): RoleDefinition | undefined;
    listRoles(): readonly string[];
    hasPermission(role: string, permission: string): boolean;
    supportsScope(role: string, scope: string): boolean;
    isReadOnly(role: string): boolean;
    canSelfProvision(role: string): boolean;
    getSessionPolicy(role: string): {
        readonly ttlSeconds?: number;
    } | undefined;
}>;
declare function defineRoleRegistry<const C extends RoleCatalog>(catalog: C): RoleRegistry<C>;

type AuthErrorCode = 'unauthenticated' | 'identity_unverified' | 'identity_not_found' | 'identity_collision' | 'identity_already_claimed' | 'provisioning_forbidden' | 'role_unknown' | 'scope_required' | 'scope_ambiguous' | 'permission_denied' | 'readonly_denied' | 'rate_limited' | 'configuration_invalid' | 'store_unavailable';
declare class AuthError extends Error {
    readonly code: AuthErrorCode;
    readonly details?: Readonly<Record<string, string>> | undefined;
    readonly name = "AuthError";
    constructor(code: AuthErrorCode, message: string, details?: Readonly<Record<string, string>> | undefined);
}

type IdentityProof = {
    readonly kind: 'email' | 'phone';
    readonly normalizedValue: string;
    readonly verified: true;
};
type AuthSession = {
    readonly id: string;
    readonly authUserId: string;
    readonly issuedAt?: string;
    readonly expiresAt: string;
    readonly activeScope?: ActiveScope;
};
type ActiveScope = {
    readonly type: string;
    readonly id: string;
    readonly membershipId?: string;
};
type Membership = {
    readonly id: string;
    readonly scope: ActiveScope;
    readonly role: string;
    readonly eligible: boolean;
};
type DomainSubject = {
    readonly subjectId: string;
    readonly authUserId?: string;
    readonly role?: string;
};
type ProvisioningDecision = {
    readonly role: string;
    readonly invitationAuthorized?: boolean;
};
type RoleStore = {
    list(): Promise<readonly RoleRecord[]>;
    findByKey(input: {
        key: string;
    }): Promise<RoleRecord | undefined>;
    upsert(input: RoleUpsert): Promise<RoleRecord>;
};
type RoleRecord = {
    readonly id: string;
    readonly key: string;
    readonly label: string;
    readonly description?: string;
    readonly permissions: readonly string[];
    readonly scopes: readonly string[];
    readonly readOnly: boolean;
};
type RoleUpsert = Omit<RoleRecord, 'id'>;
type IdentityLink = {
    readonly subjectId: string;
    readonly authUserId?: string;
    readonly proofs: readonly IdentityProof[];
};
type IdentityLinkStore = {
    findByAuthUser(input: {
        authUserId: string;
    }): Promise<IdentityLink | undefined>;
    findByProof(input: {
        proof: IdentityProof;
    }): Promise<IdentityLink | undefined>;
    createSubject(input: {
        authUserId: string;
        proofs: readonly IdentityProof[];
    }): Promise<IdentityLink>;
    claimSubject(input: {
        subjectId: string;
        authUserId: string;
    }): Promise<boolean>;
};
type MembershipResolver = {
    list(input: {
        subjectId: string;
    }): Promise<readonly Membership[]>;
};
type AuthAuditEvent = {
    readonly type: string;
    readonly outcome: string;
    readonly role?: string;
    readonly scopeType?: string;
};
type AuthAuditSink = {
    emit(event: AuthAuditEvent): Promise<void> | void;
};
type AuthClock = {
    now(): Date;
};
type AuthLogger = {
    debug(message: string, fields?: Readonly<Record<string, string>>): void;
    warn(message: string, fields?: Readonly<Record<string, string>>): void;
};
type OtpSender = {
    send(input: {
        identity: string;
        code: string;
        intent: string;
    }): Promise<void>;
};
type IdentityRateLimiter = {
    check(input: {
        identity: string;
        intent: string;
    }): Promise<{
        allowed: boolean;
        retryAfterSeconds?: number;
    }>;
    record(input: {
        identity: string;
        intent: string;
        outcome: 'success' | 'failure';
    }): Promise<void>;
};
type AuthResult<T> = {
    readonly ok: true;
    readonly value: T;
} | {
    readonly ok: false;
    readonly error: AuthError;
};

export { type AuthResult as A, type DomainSubject as D, type IdentityLinkStore as I, type MembershipResolver as M, type OtpSender as O, type ProvisioningDecision as P, type RoleRegistry as R, type RoleStore as a, type RoleRecord as b, type RoleUpsert as c, type IdentityLink as d, type IdentityProof as e, type RoleDefinition as f, type ActiveScope as g, type AuthSession as h, type AuthAuditSink as i, type AuthAuditEvent as j, type AuthClock as k, AuthError as l, type AuthErrorCode as m, type AuthLogger as n, type IdentityRateLimiter as o, type Membership as p, type RoleCatalog as q, defineRoleRegistry as r };
