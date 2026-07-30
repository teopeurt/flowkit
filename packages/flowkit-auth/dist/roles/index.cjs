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

// src/roles/index.ts
var roles_exports = {};
__export(roles_exports, {
  defineRoleRegistry: () => defineRoleRegistry,
  synchronizeRoles: () => synchronizeRoles
});
module.exports = __toCommonJS(roles_exports);

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

// src/roles/synchronization.ts
async function synchronizeRoles(registry, store, mode = "reconcile_metadata") {
  const inserted = [], unchanged = [], metadataUpdated = [], conflicts = [];
  for (const key of registry.listRoles()) {
    const role = registry.getRole(key);
    const desired = {
      key,
      label: role.label,
      description: role.description,
      permissions: [
        ...role.permissions
      ],
      scopes: [
        ...role.scopes
      ],
      readOnly: role.readOnly === true
    };
    const existing = await store.findByKey({
      key
    });
    if (!existing) {
      if (mode !== "dry_run" && mode === "insert_missing") {
        await store.upsert(desired);
      }
      inserted.push(key);
      continue;
    }
    const changed = JSON.stringify({
      ...existing,
      id: void 0
    }) !== JSON.stringify(desired);
    if (!changed) unchanged.push(key);
    else if (mode === "reconcile_metadata") {
      await store.upsert(desired);
      metadataUpdated.push(key);
    } else if (mode === "dry_run") metadataUpdated.push(key);
    else conflicts.push(key);
  }
  const known = new Set(registry.listRoles());
  const unknownDatabase = (await store.list()).filter((role) => !known.has(role.key)).map((role) => role.key);
  return {
    inserted,
    unchanged,
    metadataUpdated,
    unknownDatabase,
    conflicts
  };
}
__name(synchronizeRoles, "synchronizeRoles");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  defineRoleRegistry,
  synchronizeRoles
});
