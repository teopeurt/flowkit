import * as _nestjs_common from '@nestjs/common';
import { DynamicModule, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

declare const FLOWKIT_AUTH_RUNTIME: unique symbol;
declare const FLOWKIT_AUTH_PRINCIPAL_RESOLVER: unique symbol;
declare const FLOWKIT_AUTH_ROLE_REGISTRY: unique symbol;
declare const FLOWKIT_AUTH_AUDIT_SINK: unique symbol;

declare const AUTH_ANONYMOUS: unique symbol;
declare const AUTH_ROLES: unique symbol;
declare const AUTH_PERMISSIONS: unique symbol;
declare const AUTH_READONLY_MUTATION: unique symbol;
declare const AllowAnonymous: () => _nestjs_common.CustomDecorator<typeof AUTH_ANONYMOUS>;
declare const RequireRoles: (...roles: readonly string[]) => _nestjs_common.CustomDecorator<typeof AUTH_ROLES>;
declare const RequirePermissions: (...permissions: readonly string[]) => _nestjs_common.CustomDecorator<typeof AUTH_PERMISSIONS>;
declare const AllowReadOnlyMutation: () => _nestjs_common.CustomDecorator<typeof AUTH_READONLY_MUTATION>;
declare const CurrentPrincipal: (...dataOrPipes: unknown[]) => ParameterDecorator;
declare const CurrentSession: (...dataOrPipes: unknown[]) => ParameterDecorator;

type FlowkitAuthModuleOptions = {
    runtime: unknown;
    principalResolver: unknown;
    roleRegistry: unknown;
    auditSink?: unknown;
    guardMode?: 'global' | 'explicit';
};
declare class FlowkitAuthModule {
    static forRootAsync(input: {
        useFactory: (...args: any[]) => Promise<FlowkitAuthModuleOptions> | FlowkitAuthModuleOptions;
        inject?: readonly any[];
    }): DynamicModule;
}

declare class FlowkitPrincipalGuard implements CanActivate {
    private readonly reflector;
    private readonly resolver;
    constructor(reflector: Reflector, resolver: {
        resolve(input: {
            authUserId: string;
            session: unknown;
        }): Promise<unknown>;
    });
    canActivate(context: ExecutionContext): Promise<boolean>;
}

declare class FlowkitRolesGuard implements CanActivate {
    private readonly reflector;
    constructor(reflector: Reflector);
    canActivate(context: ExecutionContext): boolean;
}

declare class FlowkitPermissionsGuard implements CanActivate {
    private readonly reflector;
    constructor(reflector: Reflector);
    canActivate(context: ExecutionContext): boolean;
}

declare class FlowkitReadonlyGuard implements CanActivate {
    private readonly reflector;
    constructor(reflector: Reflector);
    canActivate(context: ExecutionContext): boolean;
}

export { AUTH_ANONYMOUS, AUTH_PERMISSIONS, AUTH_READONLY_MUTATION, AUTH_ROLES, AllowAnonymous, AllowReadOnlyMutation, CurrentPrincipal, CurrentSession, FLOWKIT_AUTH_AUDIT_SINK, FLOWKIT_AUTH_PRINCIPAL_RESOLVER, FLOWKIT_AUTH_ROLE_REGISTRY, FLOWKIT_AUTH_RUNTIME, FlowkitAuthModule, type FlowkitAuthModuleOptions, FlowkitPermissionsGuard, FlowkitPrincipalGuard, FlowkitReadonlyGuard, FlowkitRolesGuard, RequirePermissions, RequireRoles };
