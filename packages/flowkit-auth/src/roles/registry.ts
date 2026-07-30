import { AuthError } from '../errors';

export type RoleDefinition = { label: string; description?: string; aliases?: readonly string[]; permissions: readonly string[]; scopes: readonly string[]; kind: 'internal' | 'external' | 'system'; provisioning: 'self_service' | 'invite_only' | 'disabled'; readOnly?: boolean; sessionTtlSeconds?: number };
export type RoleCatalog = Record<string, RoleDefinition>;
export type RoleRegistry<C extends RoleCatalog> = Readonly<{ definitions: Readonly<C>; normalizeRole(role: string): string | undefined; getRole(role: string): RoleDefinition | undefined; listRoles(): readonly string[]; hasPermission(role: string, permission: string): boolean; supportsScope(role: string, scope: string): boolean; isReadOnly(role: string): boolean; canSelfProvision(role: string): boolean; getSessionPolicy(role: string): { readonly ttlSeconds?: number } | undefined }>;

export function defineRoleRegistry<const C extends RoleCatalog>(catalog: C): RoleRegistry<C> {
  const aliases = new Map<string, string>();
  for (const [key, role] of Object.entries(catalog)) {
    if (!key.trim() || role.permissions.length === 0 || role.scopes.length === 0) throw new AuthError('configuration_invalid', `Role ${key || '<blank>'} must define permissions and scopes`);
    if (role.kind === 'system' && role.provisioning === 'self_service') throw new AuthError('configuration_invalid', `System role ${key} cannot be self provisioned`);
    if (role.sessionTtlSeconds !== undefined && (!Number.isInteger(role.sessionTtlSeconds) || role.sessionTtlSeconds < 60)) throw new AuthError('configuration_invalid', `Invalid session TTL for ${key}`);
    for (const alias of role.aliases ?? []) {
      if (!alias.trim() || catalog[alias] || aliases.has(alias)) throw new AuthError('configuration_invalid', `Role alias collides: ${alias}`);
      aliases.set(alias, key);
    }
  }
  const resolve = (role: string) => Object.prototype.hasOwnProperty.call(catalog, role) ? role : aliases.get(role);
  return Object.freeze({
    definitions: Object.freeze(catalog), normalizeRole: resolve,
    getRole: role => { const key = resolve(role); return key ? catalog[key] : undefined; },
    listRoles: () => Object.freeze(Object.keys(catalog)),
    hasPermission: (role, permission) => { const definition = catalog[resolve(role) ?? '']; return definition?.permissions.includes(permission) ?? false; },
    supportsScope: (role, scope) => { const definition = catalog[resolve(role) ?? '']; return definition?.scopes.includes(scope) ?? false; },
    isReadOnly: role => catalog[resolve(role) ?? '']?.readOnly === true,
    canSelfProvision: role => catalog[resolve(role) ?? '']?.provisioning === 'self_service',
    getSessionPolicy: role => { const definition = catalog[resolve(role) ?? '']; return definition && Object.freeze({ ttlSeconds: definition.sessionTtlSeconds }); },
  });
}
