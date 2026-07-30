import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { FLOWKIT_AUTH_AUDIT_SINK, FLOWKIT_AUTH_PRINCIPAL_RESOLVER, FLOWKIT_AUTH_ROLE_REGISTRY, FLOWKIT_AUTH_RUNTIME } from './tokens';
import { FlowkitPrincipalGuard } from './principal.guard';
import { FlowkitRolesGuard } from './roles.guard';
import { FlowkitPermissionsGuard } from './permissions.guard';
import { FlowkitReadonlyGuard } from './readonly.guard';
export type FlowkitAuthModuleOptions = { runtime: unknown; principalResolver: unknown; roleRegistry: unknown; auditSink?: unknown; guardMode?: 'global' | 'explicit' };
@Global()
@Module({})
export class FlowkitAuthModule {
  static forRootAsync(input: { useFactory: (...args: any[]) => Promise<FlowkitAuthModuleOptions> | FlowkitAuthModuleOptions; inject?: readonly any[] }): DynamicModule {
    const options = { provide: 'FLOWKIT_AUTH_OPTIONS', inject: [...(input.inject ?? [])], useFactory: input.useFactory };
    const providers: Provider[] = [options, { provide: FLOWKIT_AUTH_RUNTIME, useFactory: (value: FlowkitAuthModuleOptions) => value.runtime, inject: ['FLOWKIT_AUTH_OPTIONS'] }, { provide: FLOWKIT_AUTH_PRINCIPAL_RESOLVER, useFactory: (value: FlowkitAuthModuleOptions) => value.principalResolver, inject: ['FLOWKIT_AUTH_OPTIONS'] }, { provide: FLOWKIT_AUTH_ROLE_REGISTRY, useFactory: (value: FlowkitAuthModuleOptions) => value.roleRegistry, inject: ['FLOWKIT_AUTH_OPTIONS'] }, { provide: FLOWKIT_AUTH_AUDIT_SINK, useFactory: (value: FlowkitAuthModuleOptions) => value.auditSink, inject: ['FLOWKIT_AUTH_OPTIONS'] }, FlowkitPrincipalGuard, FlowkitRolesGuard, FlowkitPermissionsGuard, FlowkitReadonlyGuard];
    return { module: FlowkitAuthModule, global: true, providers, exports: [FLOWKIT_AUTH_RUNTIME, FLOWKIT_AUTH_PRINCIPAL_RESOLVER, FLOWKIT_AUTH_ROLE_REGISTRY, FLOWKIT_AUTH_AUDIT_SINK, FlowkitPrincipalGuard, FlowkitRolesGuard, FlowkitPermissionsGuard, FlowkitReadonlyGuard] };
  }
}
