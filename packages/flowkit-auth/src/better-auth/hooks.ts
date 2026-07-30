export type AuthHook = (context: Readonly<Record<string, unknown>>) => void | Promise<void>;
export function composeAuthHooks(required: readonly AuthHook[], extensions: readonly AuthHook[] = []) { return async (context: Readonly<Record<string, unknown>>) => { for (const hook of [...required, ...extensions]) await hook(context); }; }
