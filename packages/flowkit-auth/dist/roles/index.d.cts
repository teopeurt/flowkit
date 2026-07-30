import { R as RoleRegistry, a as RoleStore } from '../registry-mLTfQxoY.cjs';
export { q as RoleCatalog, f as RoleDefinition, r as defineRoleRegistry } from '../registry-mLTfQxoY.cjs';

type SynchronizationMode = 'insert_missing' | 'reconcile_metadata' | 'dry_run';
type SynchronizationReport = {
    inserted: readonly string[];
    unchanged: readonly string[];
    metadataUpdated: readonly string[];
    unknownDatabase: readonly string[];
    conflicts: readonly string[];
};
declare function synchronizeRoles(registry: RoleRegistry<any>, store: RoleStore, mode?: SynchronizationMode): Promise<SynchronizationReport>;

export { RoleRegistry, type SynchronizationMode, type SynchronizationReport, synchronizeRoles };
