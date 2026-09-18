"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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
var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
  for (var i = decorators.length - 1, decorator; i >= 0; i--)
    if (decorator = decorators[i])
      result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result) __defProp(target, key, result);
  return result;
};
var __decorateParam = (index, decorator) => (target, key) => decorator(target, key, index);

// src/nest/index.ts
var nest_exports = {};
__export(nest_exports, {
  AUTH_ANONYMOUS: () => AUTH_ANONYMOUS,
  AUTH_PERMISSIONS: () => AUTH_PERMISSIONS,
  AUTH_READONLY_MUTATION: () => AUTH_READONLY_MUTATION,
  AUTH_ROLES: () => AUTH_ROLES,
  AllowAnonymous: () => AllowAnonymous,
  AllowReadOnlyMutation: () => AllowReadOnlyMutation,
  CurrentPrincipal: () => CurrentPrincipal,
  CurrentSession: () => CurrentSession,
  FLOWKIT_AUTH_AUDIT_SINK: () => FLOWKIT_AUTH_AUDIT_SINK,
  FLOWKIT_AUTH_PRINCIPAL_RESOLVER: () => FLOWKIT_AUTH_PRINCIPAL_RESOLVER,
  FLOWKIT_AUTH_ROLE_REGISTRY: () => FLOWKIT_AUTH_ROLE_REGISTRY,
  FLOWKIT_AUTH_RUNTIME: () => FLOWKIT_AUTH_RUNTIME,
  FlowkitAuthModule: () => FlowkitAuthModule,
  FlowkitPermissionsGuard: () => FlowkitPermissionsGuard,
  FlowkitPrincipalGuard: () => FlowkitPrincipalGuard,
  FlowkitReadonlyGuard: () => FlowkitReadonlyGuard,
  FlowkitRolesGuard: () => FlowkitRolesGuard,
  RequirePermissions: () => RequirePermissions,
  RequireRoles: () => RequireRoles
});
module.exports = __toCommonJS(nest_exports);

// src/nest/tokens.ts
var FLOWKIT_AUTH_RUNTIME = /* @__PURE__ */ Symbol("FLOWKIT_AUTH_RUNTIME");
var FLOWKIT_AUTH_PRINCIPAL_RESOLVER = /* @__PURE__ */ Symbol("FLOWKIT_AUTH_PRINCIPAL_RESOLVER");
var FLOWKIT_AUTH_ROLE_REGISTRY = /* @__PURE__ */ Symbol("FLOWKIT_AUTH_ROLE_REGISTRY");
var FLOWKIT_AUTH_AUDIT_SINK = /* @__PURE__ */ Symbol("FLOWKIT_AUTH_AUDIT_SINK");

// src/nest/decorators.ts
var import_common = require("@nestjs/common");
var AUTH_ANONYMOUS = /* @__PURE__ */ Symbol("flowkit:anonymous");
var AUTH_ROLES = /* @__PURE__ */ Symbol("flowkit:roles");
var AUTH_PERMISSIONS = /* @__PURE__ */ Symbol("flowkit:permissions");
var AUTH_READONLY_MUTATION = /* @__PURE__ */ Symbol("flowkit:readonly-mutation");
var AllowAnonymous = () => (0, import_common.SetMetadata)(AUTH_ANONYMOUS, true);
var RequireRoles = (...roles) => (0, import_common.SetMetadata)(AUTH_ROLES, roles);
var RequirePermissions = (...permissions) => (0, import_common.SetMetadata)(AUTH_PERMISSIONS, permissions);
var AllowReadOnlyMutation = () => (0, import_common.SetMetadata)(AUTH_READONLY_MUTATION, true);
var CurrentPrincipal = (0, import_common.createParamDecorator)((_, context) => context.switchToHttp().getRequest().user);
var CurrentSession = (0, import_common.createParamDecorator)((_, context) => context.switchToHttp().getRequest().authSession);

// src/nest/flowkit-auth.module.ts
var import_common6 = require("@nestjs/common");

// src/nest/principal.guard.ts
var import_common2 = require("@nestjs/common");

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
    if (!request.authUserId || !request.authSession) throw new import_common2.UnauthorizedException("Authentication required");
    try {
      request.user = await this.resolver.resolve({ authUserId: request.authUserId, session: request.authSession });
      return true;
    } catch (error) {
      if (error instanceof AuthError && error.code === "unauthenticated") throw new import_common2.UnauthorizedException(error.message);
      throw error;
    }
  }
};
FlowkitPrincipalGuard = __decorateClass([
  (0, import_common2.Injectable)(),
  __decorateParam(1, (0, import_common2.Inject)(FLOWKIT_AUTH_PRINCIPAL_RESOLVER))
], FlowkitPrincipalGuard);

// src/nest/roles.guard.ts
var import_common3 = require("@nestjs/common");
var FlowkitRolesGuard = class {
  constructor(reflector) {
    this.reflector = reflector;
  }
  reflector;
  canActivate(context) {
    const roles = this.reflector.getAllAndOverride(AUTH_ROLES, [context.getHandler(), context.getClass()]);
    if (!roles?.length) return true;
    const principal = context.switchToHttp().getRequest().user;
    if (!principal || !roles.includes(principal.role)) throw new import_common3.ForbiddenException("Role denied");
    return true;
  }
};
FlowkitRolesGuard = __decorateClass([
  (0, import_common3.Injectable)()
], FlowkitRolesGuard);

// src/nest/permissions.guard.ts
var import_common4 = require("@nestjs/common");
var FlowkitPermissionsGuard = class {
  constructor(reflector) {
    this.reflector = reflector;
  }
  reflector;
  canActivate(context) {
    const permissions = this.reflector.getAllAndOverride(AUTH_PERMISSIONS, [context.getHandler(), context.getClass()]);
    if (!permissions?.length) return true;
    const principal = context.switchToHttp().getRequest().user;
    if (!principal || permissions.some((permission) => !principal.permissions.includes(permission))) throw new import_common4.ForbiddenException("Permission denied");
    return true;
  }
};
FlowkitPermissionsGuard = __decorateClass([
  (0, import_common4.Injectable)()
], FlowkitPermissionsGuard);

// src/nest/readonly.guard.ts
var import_common5 = require("@nestjs/common");
var FlowkitReadonlyGuard = class {
  constructor(reflector) {
    this.reflector = reflector;
  }
  reflector;
  canActivate(context) {
    if (this.reflector.getAllAndOverride(AUTH_READONLY_MUTATION, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest();
    if (request.user?.readOnly && ["POST", "PUT", "PATCH", "DELETE"].includes(request.method ?? "")) throw new import_common5.ForbiddenException("Readonly principal cannot mutate");
    return true;
  }
};
FlowkitReadonlyGuard = __decorateClass([
  (0, import_common5.Injectable)()
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
  (0, import_common6.Global)(),
  (0, import_common6.Module)({})
], FlowkitAuthModule);
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
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
});
