// src/config.ts
import { z } from "zod";
var authConfigSchema = z.object({
  environment: z.enum(["development", "test", "production"]),
  sessionTtlSeconds: z.number().int().min(60).max(31536e3),
  allowFixedTestOtp: z.boolean().default(false)
}).strict();
function parseAuthConfig(input) {
  const result = authConfigSchema.safeParse(input);
  if (!result.success) throw new Error(`Invalid auth configuration: ${result.error.issues.map((issue) => issue.path.join(".") || "root").join(", ")}`);
  if (result.data.environment === "production" && result.data.allowFixedTestOtp) throw new Error("Fixed OTP codes are not allowed in production");
  return Object.freeze(result.data);
}

// src/errors.ts
var AuthError = class extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
  code;
  details;
  name = "AuthError";
};

// src/principal.ts
function freezePrincipal(principal) {
  return Object.freeze({ ...principal, permissions: Object.freeze([...principal.permissions]), identityProofs: Object.freeze([...principal.identityProofs]), session: Object.freeze({ ...principal.session }), activeScope: principal.activeScope && Object.freeze({ ...principal.activeScope }) });
}

// src/identity.ts
function verifiedProofs(input, normalizePhone) {
  const proofs = [];
  if (input.email?.verified) proofs.push({ kind: "email", normalizedValue: input.email.value.trim().toLowerCase(), verified: true });
  if (input.phone?.verified) proofs.push({ kind: "phone", normalizedValue: normalizePhone ? normalizePhone(input.phone.value) : input.phone.value.trim(), verified: true });
  return Object.freeze(proofs);
}

// src/provisioning.ts
async function provisionIdentity(input) {
  const existing = await input.store.findByAuthUser({ authUserId: input.authUserId });
  if (existing) return { subjectId: existing.subjectId };
  if (input.proofs.length === 0) throw new AuthError("identity_unverified", "A verified identity proof is required");
  if (!input.registry.canSelfProvision(input.decision.role) && !input.decision.invitationAuthorized) throw new AuthError("provisioning_forbidden", "Role cannot be self provisioned");
  const matches = (await Promise.all(input.proofs.map((proof) => input.store.findByProof({ proof })))).filter(Boolean);
  const subjects = new Set(matches.map((match) => match.subjectId));
  if (subjects.size > 1) throw new AuthError("identity_collision", "Verified identities belong to different subjects");
  if (matches[0]) {
    const claimed = await input.store.claimSubject({ subjectId: matches[0].subjectId, authUserId: input.authUserId });
    if (!claimed) {
      const winner = await input.store.findByAuthUser({ authUserId: input.authUserId });
      if (winner) return { subjectId: winner.subjectId };
      throw new AuthError("identity_already_claimed", "Identity was claimed by another account");
    }
    return { subjectId: matches[0].subjectId };
  }
  const created = await input.store.createSubject({ authUserId: input.authUserId, proofs: input.proofs });
  return { subjectId: created.subjectId };
}

// src/principal-resolver.ts
async function resolvePrincipal(input) {
  const link = await input.identities.findByAuthUser({ authUserId: input.authUserId });
  if (!link) throw new AuthError("identity_not_found", "No domain identity is linked");
  const memberships = (await input.memberships.list({ subjectId: link.subjectId })).filter((membership) => membership.eligible);
  let active = input.session.activeScope;
  if (active) {
    const found = memberships.find((m) => m.scope.type === active.type && m.scope.id === active.id && (!active.membershipId || m.id === active.membershipId));
    if (!found) throw new AuthError("scope_required", "Requested scope is not available");
    active = { ...found.scope, membershipId: found.id };
  } else if (memberships.length === 1) active = { ...memberships[0].scope, membershipId: memberships[0].id };
  else if (memberships.length > 1) throw new AuthError("scope_ambiguous", "An active scope must be selected");
  const role = active ? memberships.find((m) => m.scope.id === active.id)?.role : input.role;
  const key = role && input.registry.normalizeRole(role);
  const definition = key && input.registry.getRole(key);
  if (!key || !definition) throw new AuthError("role_unknown", "Principal role is not registered");
  await input.audit?.emit({ type: "principal.resolved", outcome: "success", role: key, scopeType: active?.type });
  return freezePrincipal({ authUserId: input.authUserId, subjectId: link.subjectId, role: key, permissions: Object.freeze([...definition.permissions]), readOnly: definition.readOnly === true, identityProofs: link.proofs, activeScope: active, session: { id: input.session.id, issuedAt: input.session.issuedAt, expiresAt: input.session.expiresAt } });
}

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
  const resolve = (role) => Object.prototype.hasOwnProperty.call(catalog, role) ? role : aliases.get(role);
  return Object.freeze({
    definitions: Object.freeze(catalog),
    normalizeRole: resolve,
    getRole: (role) => {
      const key = resolve(role);
      return key ? catalog[key] : void 0;
    },
    listRoles: () => Object.freeze(Object.keys(catalog)),
    hasPermission: (role, permission) => {
      const definition = catalog[resolve(role) ?? ""];
      return definition?.permissions.includes(permission) ?? false;
    },
    supportsScope: (role, scope) => {
      const definition = catalog[resolve(role) ?? ""];
      return definition?.scopes.includes(scope) ?? false;
    },
    isReadOnly: (role) => catalog[resolve(role) ?? ""]?.readOnly === true,
    canSelfProvision: (role) => catalog[resolve(role) ?? ""]?.provisioning === "self_service",
    getSessionPolicy: (role) => {
      const definition = catalog[resolve(role) ?? ""];
      return definition && Object.freeze({ ttlSeconds: definition.sessionTtlSeconds });
    }
  });
}

// src/roles/synchronization.ts
async function synchronizeRoles(registry, store, mode = "reconcile_metadata") {
  const inserted = [], unchanged = [], metadataUpdated = [], conflicts = [];
  for (const key of registry.listRoles()) {
    const role = registry.getRole(key);
    const desired = { key, label: role.label, description: role.description, permissions: [...role.permissions], scopes: [...role.scopes], readOnly: role.readOnly === true };
    const existing = await store.findByKey({ key });
    if (!existing) {
      if (mode !== "dry_run" && mode === "insert_missing") {
        await store.upsert(desired);
      }
      inserted.push(key);
      continue;
    }
    const changed = JSON.stringify({ ...existing, id: void 0 }) !== JSON.stringify(desired);
    if (!changed) unchanged.push(key);
    else if (mode === "reconcile_metadata") {
      await store.upsert(desired);
      metadataUpdated.push(key);
    } else if (mode === "dry_run") metadataUpdated.push(key);
    else conflicts.push(key);
  }
  const known = new Set(registry.listRoles());
  const unknownDatabase = (await store.list()).filter((role) => !known.has(role.key)).map((role) => role.key);
  return { inserted, unchanged, metadataUpdated, unknownDatabase, conflicts };
}

// src/better-auth/config.ts
function validateBetterAuthOptions(options) {
  if (!options.secret.trim() || options.secret.length < 32) throw new Error("BetterAuth secret must be at least 32 characters");
  if (options.environment === "production" && options.trustedOrigins.some((origin) => origin.includes("localhost"))) throw new Error("Localhost trusted origins are not allowed in production");
  return Object.freeze({ ...options, basePath: options.basePath ?? "/api/auth", enabled: options.enabled ?? true });
}

// src/better-auth/runtime.ts
function createAuthRuntime(options) {
  const config = validateBetterAuthOptions(options);
  return Object.freeze({ config, enabled: config.enabled, getOptions: () => config });
}
var createBetterAuthRuntime = createAuthRuntime;

// src/better-auth/phone-policy.ts
function createPhonePolicy(input) {
  const callingCode = input.callingCode.replace(/^\+/, "");
  const trunk = input.trunkPrefix ?? "0";
  return Object.freeze({ normalize(value) {
    let raw = value.replace(/[\s()-]/g, "");
    if (raw.startsWith("+")) return `+${raw.slice(1)}`;
    if (raw.startsWith(trunk)) raw = raw.slice(trunk.length);
    return `+${callingCode}${raw}`;
  }, isValid(value) {
    return input.nationalNumber.test(value.replace(/[\s()-]/g, "").replace(new RegExp(`^\\+${callingCode}`), "").replace(new RegExp(`^${trunk}`), ""));
  } });
}
function createCustomPhonePolicy(normalize, isValid) {
  return Object.freeze({ normalize, isValid });
}

// src/better-auth/otp-intents.ts
function createOtpIntentRegistry(intents) {
  const map = new Map(intents.map((intent) => [intent.name, intent]));
  return Object.freeze({ async authorize(input) {
    const found = map.get(input.intent);
    if (!found) return { ok: false, error: new AuthError("permission_denied", "Unknown OTP intent") };
    const result = await found.authorize({ identity: input.identity, context: input.context ?? {} });
    return result.allowed ? { ok: true, value: { reason: result.reason } } : { ok: false, error: new AuthError("permission_denied", result.reason) };
  } });
}

// src/index.ts
var FLOWKIT_AUTH_VERSION = "0.2.0";
export {
  AuthError,
  FLOWKIT_AUTH_VERSION,
  authConfigSchema,
  createAuthRuntime,
  createBetterAuthRuntime,
  createCustomPhonePolicy,
  createOtpIntentRegistry,
  createPhonePolicy,
  defineRoleRegistry,
  freezePrincipal,
  parseAuthConfig,
  provisionIdentity,
  resolvePrincipal,
  synchronizeRoles,
  validateBetterAuthOptions,
  verifiedProofs
};
