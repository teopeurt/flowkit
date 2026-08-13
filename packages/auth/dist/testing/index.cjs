"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/testing/index.ts
var testing_exports = {};
__export(testing_exports, {
  InMemoryIdentityLinkStore: () => InMemoryIdentityLinkStore,
  InMemoryRoleStore: () => InMemoryRoleStore,
  createTestClock: () => createTestClock,
  leaveApprovalFixture: () => leaveApprovalFixture,
  testingContractVersion: () => testingContractVersion
});
module.exports = __toCommonJS(testing_exports);

// src/testing/in-memory-role.store.ts
var InMemoryRoleStore = class {
  static {
    __name(this, "InMemoryRoleStore");
  }
  roles = /* @__PURE__ */ new Map();
  nextId = 1;
  async findByKey({ key }) {
    return this.roles.get(key);
  }
  async upsert(input) {
    const current = this.roles.get(input.key);
    const record = {
      ...input,
      id: current?.id ?? `role-${this.nextId++}`
    };
    this.roles.set(input.key, record);
    return record;
  }
  async list() {
    return [
      ...this.roles.values()
    ];
  }
};

// src/testing/in-memory-identity-link.store.ts
var InMemoryIdentityLinkStore = class {
  static {
    __name(this, "InMemoryIdentityLinkStore");
  }
  links = /* @__PURE__ */ new Map();
  byProof = /* @__PURE__ */ new Map();
  nextId = 1;
  async findByAuthUser({ authUserId }) {
    return [
      ...this.links.values()
    ].find((link) => link.authUserId === authUserId);
  }
  async findByProof({ proof }) {
    const id = this.byProof.get(`${proof.kind}:${proof.normalizedValue}`);
    return id ? this.links.get(id) : void 0;
  }
  async createSubject(input) {
    const link = {
      subjectId: `subject-${this.nextId++}`,
      authUserId: input.authUserId,
      proofs: Object.freeze([
        ...input.proofs
      ])
    };
    this.links.set(link.subjectId, link);
    for (const proof of input.proofs) this.byProof.set(`${proof.kind}:${proof.normalizedValue}`, link.subjectId);
    return link;
  }
  async claimSubject(input) {
    const link = this.links.get(input.subjectId);
    if (!link || link.authUserId) return false;
    this.links.set(input.subjectId, {
      ...link,
      authUserId: input.authUserId
    });
    return true;
  }
};

// src/errors.ts
var AuthError = class extends Error {
  static {
    __name(this, "AuthError");
  }
  code;
  details;
  name;
  constructor(code, message, details) {
    super(message), this.code = code, this.details = details, this.name = "AuthError";
  }
};

// src/roles/registry.ts
function defineRoleRegistry(catalog) {
  const aliases = /* @__PURE__ */ new Map();
  for (const [key, role] of Object.entries(catalog)) {
    if (!key.trim() || role.permissions.length === 0 || role.scopes.length === 0) throw new AuthError("configuration_invalid", `Role ${key || "<blank>"} must define permissions and scopes`);
    if (role.kind === "system" && role.provisioning === "self_service") throw new AuthError("configuration_invalid", `System role ${key} cannot be self provisioned`);
    if (role.sessionTtlSeconds !== void 0 && (!Number.isInteger(role.sessionTtlSeconds) || role.sessionTtlSeconds < 60)) throw new AuthError("configuration_invalid", `Invalid session TTL for ${key}`);
    for (const alias of role.aliases ?? []) {
      if (!alias.trim() || catalog[alias] || aliases.has(alias)) throw new AuthError("configuration_invalid", `Role alias collides: ${alias}`);
      aliases.set(alias, key);
    }
  }
  const resolve = /* @__PURE__ */ __name((role) => Object.prototype.hasOwnProperty.call(catalog, role) ? role : aliases.get(role), "resolve");
  return Object.freeze({
    definitions: Object.freeze(catalog),
    normalizeRole: resolve,
    getRole: /* @__PURE__ */ __name((role) => {
      const key = resolve(role);
      return key ? catalog[key] : void 0;
    }, "getRole"),
    listRoles: /* @__PURE__ */ __name(() => Object.freeze(Object.keys(catalog)), "listRoles"),
    hasPermission: /* @__PURE__ */ __name((role, permission) => {
      const definition = catalog[resolve(role) ?? ""];
      return definition?.permissions.includes(permission) ?? false;
    }, "hasPermission"),
    supportsScope: /* @__PURE__ */ __name((role, scope) => {
      const definition = catalog[resolve(role) ?? ""];
      return definition?.scopes.includes(scope) ?? false;
    }, "supportsScope"),
    isReadOnly: /* @__PURE__ */ __name((role) => catalog[resolve(role) ?? ""]?.readOnly === true, "isReadOnly"),
    canSelfProvision: /* @__PURE__ */ __name((role) => catalog[resolve(role) ?? ""]?.provisioning === "self_service", "canSelfProvision"),
    getSessionPolicy: /* @__PURE__ */ __name((role) => {
      const definition = catalog[resolve(role) ?? ""];
      return definition && Object.freeze({
        ttlSeconds: definition.sessionTtlSeconds
      });
    }, "getSessionPolicy")
  });
}
__name(defineRoleRegistry, "defineRoleRegistry");

// src/testing/leave-approval.fixture.ts
var leaveApprovalFixture = defineRoleRegistry({
  employee: {
    label: "Employee",
    permissions: [
      "leave:read"
    ],
    scopes: [
      "company"
    ],
    kind: "external",
    provisioning: "self_service"
  },
  approver: {
    label: "Approver",
    permissions: [
      "leave:read",
      "leave:approve"
    ],
    scopes: [
      "company"
    ],
    kind: "internal",
    provisioning: "invite_only"
  }
});

// src/testing/contract-suites.ts
var testingContractVersion = "0.2.0";
function createTestClock(initial = /* @__PURE__ */ new Date("2026-01-01T00:00:00.000Z")) {
  let current = new Date(initial);
  return {
    now: /* @__PURE__ */ __name(() => new Date(current), "now"),
    advance: /* @__PURE__ */ __name((milliseconds) => {
      current = new Date(current.getTime() + milliseconds);
    }, "advance")
  };
}
__name(createTestClock, "createTestClock");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  InMemoryIdentityLinkStore,
  InMemoryRoleStore,
  createTestClock,
  leaveApprovalFixture,
  testingContractVersion
});
