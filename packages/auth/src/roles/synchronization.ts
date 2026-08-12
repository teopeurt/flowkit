import type { RoleStore, RoleRecord } from '../contracts';
import type { RoleRegistry } from './registry';

export type SynchronizationMode = 'insert_missing' | 'reconcile_metadata' | 'dry_run';
export type SynchronizationReport = { inserted: readonly string[]; unchanged: readonly string[]; metadataUpdated: readonly string[]; unknownDatabase: readonly string[]; conflicts: readonly string[] };

export async function synchronizeRoles(registry: RoleRegistry<any>, store: RoleStore, mode: SynchronizationMode = 'reconcile_metadata'): Promise<SynchronizationReport> {
  const inserted: string[] = [], unchanged: string[] = [], metadataUpdated: string[] = [], conflicts: string[] = [];
  for (const key of registry.listRoles()) {
    const role = registry.getRole(key)!;
    const desired = { key, label: role.label, description: role.description, permissions: [...role.permissions], scopes: [...role.scopes], readOnly: role.readOnly === true };
    const existing = await store.findByKey({ key });
    if (!existing) { if (mode !== 'dry_run' && mode === 'insert_missing') { await store.upsert(desired); } inserted.push(key); continue; }
    const changed = JSON.stringify({ ...existing, id: undefined }) !== JSON.stringify(desired);
    if (!changed) unchanged.push(key);
    else if (mode === 'reconcile_metadata') { await store.upsert(desired); metadataUpdated.push(key); }
    else if (mode === 'dry_run') metadataUpdated.push(key);
    else conflicts.push(key);
  }
  const known = new Set(registry.listRoles());
  const unknownDatabase = (await store.list()).filter(role => !known.has(role.key)).map(role => role.key);
  return { inserted, unchanged, metadataUpdated, unknownDatabase, conflicts };
}
