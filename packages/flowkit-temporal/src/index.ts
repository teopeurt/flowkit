export const FLOWKIT_TEMPORAL_VERSION = '0.1.0';

// Placeholder for the snapshot module wired in by the snapshot task. Keeping
// the named export here lets the package-scaffold verification prove that the
// dual ESM/CJS build emits a usable public surface before the implementation
// lands.
export function publishDefinition(): never {
  throw new Error('publishDefinition is not implemented yet.');
}
