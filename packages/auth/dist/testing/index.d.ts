import { a as RoleStore, b as RoleRecord, c as RoleUpsert, I as IdentityLinkStore, d as IdentityLink, e as IdentityProof, f as RoleDefinition } from '../contracts-CqPcJqVW.js';

declare class InMemoryRoleStore implements RoleStore {
    private readonly roles;
    private nextId;
    findByKey({ key }: {
        key: string;
    }): Promise<RoleRecord | undefined>;
    upsert(input: RoleUpsert): Promise<{
        id: string;
        key: string;
        label: string;
        description?: string;
        permissions: readonly string[];
        scopes: readonly string[];
        readOnly: boolean;
    }>;
    list(): Promise<RoleRecord[]>;
}

declare class InMemoryIdentityLinkStore implements IdentityLinkStore {
    private readonly links;
    private readonly byProof;
    private nextId;
    findByAuthUser({ authUserId }: {
        authUserId: string;
    }): Promise<IdentityLink | undefined>;
    findByProof({ proof }: {
        proof: IdentityProof;
    }): Promise<IdentityLink | undefined>;
    createSubject(input: {
        authUserId: string;
        proofs: readonly IdentityProof[];
    }): Promise<{
        subjectId: string;
        authUserId: string;
        proofs: readonly IdentityProof[];
    }>;
    claimSubject(input: {
        subjectId: string;
        authUserId: string;
    }): Promise<boolean>;
}

declare const leaveApprovalFixture: Readonly<{
    definitions: Readonly<{
        readonly employee: {
            readonly label: "Employee";
            readonly permissions: readonly ["leave:read"];
            readonly scopes: readonly ["company"];
            readonly kind: "external";
            readonly provisioning: "self_service";
        };
        readonly approver: {
            readonly label: "Approver";
            readonly permissions: readonly ["leave:read", "leave:approve"];
            readonly scopes: readonly ["company"];
            readonly kind: "internal";
            readonly provisioning: "invite_only";
        };
    }>;
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

declare const testingContractVersion = "0.2.0";
declare function createTestClock(initial?: Date): {
    now: () => Date;
    advance: (milliseconds: number) => void;
};

export { InMemoryIdentityLinkStore, InMemoryRoleStore, createTestClock, leaveApprovalFixture, testingContractVersion };
