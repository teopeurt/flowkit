// Workflow-bundle entry point for `@flowkit/temporal/workflow`.
//
// Only workflow-sandbox-safe modules may be reachable from this entry: no
// Node builtins, no I/O libraries, no `Date`/randomness-dependent code. The
// serialized interpreter factory (`createFlowkitWorkflow`) is attached to
// this entry by the interpreter task.
export const FLOWKIT_WORKFLOW_ENTRY = true;
