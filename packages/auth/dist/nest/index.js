var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
  for (var i = decorators.length - 1, decorator; i >= 0; i--)
    if (decorator = decorators[i])
      result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result) __defProp(target, key, result);
  return result;
};
var __decorateParam = (index, decorator) => (target, key) => decorator(target, key, index);

// src/nest/tokens.ts
var FLOWKIT_AUTH_RUNTIME = /* @__PURE__ */ Symbol("FLOWKIT_AUTH_RUNTIME");
var FLOWKIT_AUTH_PRINCIPAL_RESOLVER = /* @__PURE__ */ Symbol("FLOWKIT_AUTH_PRINCIPAL_RESOLVER");
var FLOWKIT_AUTH_ROLE_REGISTRY = /* @__PURE__ */ Symbol("FLOWKIT_AUTH_ROLE_REGISTRY");
var FLOWKIT_AUTH_AUDIT_SINK = /* @__PURE__ */ Symbol("FLOWKIT_AUTH_AUDIT_SINK");

// src/nest/decorators.ts
import { SetMetadata, createParamDecorator } from "@nestjs/common";
var AUTH_ANONYMOUS = /* @__PURE__ */ Symbol("flowkit:anonymous");
var AUTH_ROLES = /* @__PURE__ */ Symbol("flowkit:roles");
var AUTH_PERMISSIONS = /* @__PURE__ */ Symbol("flowkit:permissions");
var AUTH_READONLY_MUTATION = /* @__PURE__ */ Symbol("flowkit:readonly-mutation");
var AllowAnonymous = () => SetMetadata(AUTH_ANONYMOUS, true);
var RequireRoles = (...roles) => SetMetadata(AUTH_ROLES, roles);
var RequirePermissions = (...permissions) => SetMetadata(AUTH_PERMISSIONS, permissions);
var AllowReadOnlyMutation = () => SetMetadata(AUTH_READONLY_MUTATION, true);
var CurrentPrincipal = createParamDecorator((_, context) => context.switchToHttp().getRequest().user);
var CurrentSession = createParamDecorator((_, context) => context.switchToHttp().getRequest().authSession);

// src/nest/flowkit-auth.module.ts
import { Global, Module } from "@nestjs/common";

// src/nest/principal.guard.ts
import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";

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

// src/nest/principal.guard.ts
var FlowkitPrincipalGuard = class {
  constructor(reflector, resolver) {
    this.reflector = reflector;
    this.resolver = resolver;
  }
  reflector;
  resolver;
  async canActivate(context) {
    if (this.reflector.getAllAndOverride(AUTH_ANONYMOUS, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest();
    if (!request.authUserId || !request.authSession) throw new UnauthorizedException("Authentication required");
    try {
      request.user = await this.resolver.resolve({ authUserId: request.authUserId, session: request.authSession });
      return true;
    } catch (error) {
      if (error instanceof AuthError && error.code === "unauthenticated") throw new UnauthorizedException(error.message);
      throw error;
    }
  }
};
FlowkitPrincipalGuard = __decorateClass([
  Injectable(),
  __decorateParam(1, Inject(FLOWKIT_AUTH_PRINCIPAL_RESOLVER))
], FlowkitPrincipalGuard);

// src/nest/roles.guard.ts
import { ForbiddenException, Injectable as Injectable2 } from "@nestjs/common";
var FlowkitRolesGuard = class {
  constructor(reflector) {
    this.reflector = reflector;
  }
  reflector;
  canActivate(context) {
    const roles = this.reflector.getAllAndOverride(AUTH_ROLES, [context.getHandler(), context.getClass()]);
    if (!roles?.length) return true;
    const principal = context.switchToHttp().getRequest().user;
    if (!principal || !roles.includes(principal.role)) throw new ForbiddenException("Role denied");
    return true;
  }
};
FlowkitRolesGuard = __decorateClass([
  Injectable2()
], FlowkitRolesGuard);

// src/nest/permissions.guard.ts
import { ForbiddenException as ForbiddenException2, Injectable as Injectable3 } from "@nestjs/common";
var FlowkitPermissionsGuard = class {
  constructor(reflector) {
    this.reflector = reflector;
  }
  reflector;
  canActivate(context) {
    const permissions = this.reflector.getAllAndOverride(AUTH_PERMISSIONS, [context.getHandler(), context.getClass()]);
    if (!permissions?.length) return true;
    const principal = context.switchToHttp().getRequest().user;
    if (!principal || permissions.some((permission) => !principal.permissions.includes(permission))) throw new ForbiddenException2("Permission denied");
    return true;
  }
};
FlowkitPermissionsGuard = __decorateClass([
  Injectable3()
], FlowkitPermissionsGuard);

// src/nest/readonly.guard.ts
import { ForbiddenException as ForbiddenException3, Injectable as Injectable4 } from "@nestjs/common";
var FlowkitReadonlyGuard = class {
  constructor(reflector) {
    this.reflector = reflector;
  }
  reflector;
  canActivate(context) {
    if (this.reflector.getAllAndOverride(AUTH_READONLY_MUTATION, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest();
    if (request.user?.readOnly && ["POST", "PUT", "PATCH", "DELETE"].includes(request.method ?? "")) throw new ForbiddenException3("Readonly principal cannot mutate");
    return true;
  }
};
FlowkitReadonlyGuard = __decorateClass([
  Injectable4()
], FlowkitReadonlyGuard);

// src/nest/flowkit-auth.module.ts
var FlowkitAuthModule = class {
  static forRootAsync(input) {
    const options = { provide: "FLOWKIT_AUTH_OPTIONS", inject: [...input.inject ?? []], useFactory: input.useFactory };
    const providers = [options, { provide: FLOWKIT_AUTH_RUNTIME, useFactory: (value) => value.runtime, inject: ["FLOWKIT_AUTH_OPTIONS"] }, { provide: FLOWKIT_AUTH_PRINCIPAL_RESOLVER, useFactory: (value) => value.principalResolver, inject: ["FLOWKIT_AUTH_OPTIONS"] }, { provide: FLOWKIT_AUTH_ROLE_REGISTRY, useFactory: (value) => value.roleRegistry, inject: ["FLOWKIT_AUTH_OPTIONS"] }, { provide: FLOWKIT_AUTH_AUDIT_SINK, useFactory: (value) => value.auditSink, inject: ["FLOWKIT_AUTH_OPTIONS"] }, FlowkitPrincipalGuard, FlowkitRolesGuard, FlowkitPermissionsGuard, FlowkitReadonlyGuard];
    return { module: FlowkitAuthModule, global: true, providers, exports: [FLOWKIT_AUTH_RUNTIME, FLOWKIT_AUTH_PRINCIPAL_RESOLVER, FLOWKIT_AUTH_ROLE_REGISTRY, FLOWKIT_AUTH_AUDIT_SINK, FlowkitPrincipalGuard, FlowkitRolesGuard, FlowkitPermissionsGuard, FlowkitReadonlyGuard] };
  }
};
FlowkitAuthModule = __decorateClass([
  Global(),
  Module({})
], FlowkitAuthModule);
export {
  AUTH_ANONYMOUS,
  AUTH_PERMISSIONS,
  AUTH_READONLY_MUTATION,
  AUTH_ROLES,
  AllowAnonymous,
  AllowReadOnlyMutation,
  CurrentPrincipal,
  CurrentSession,
  FLOWKIT_AUTH_AUDIT_SINK,
  FLOWKIT_AUTH_PRINCIPAL_RESOLVER,
  FLOWKIT_AUTH_ROLE_REGISTRY,
  FLOWKIT_AUTH_RUNTIME,
  FlowkitAuthModule,
  FlowkitPermissionsGuard,
  FlowkitPrincipalGuard,
  FlowkitReadonlyGuard,
  FlowkitRolesGuard,
  RequirePermissions,
  RequireRoles
};
