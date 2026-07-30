"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
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
var AllowAnonymous = /* @__PURE__ */ __name(() => (0, import_common.SetMetadata)(AUTH_ANONYMOUS, true), "AllowAnonymous");
var RequireRoles = /* @__PURE__ */ __name((...roles) => (0, import_common.SetMetadata)(AUTH_ROLES, roles), "RequireRoles");
var RequirePermissions = /* @__PURE__ */ __name((...permissions) => (0, import_common.SetMetadata)(AUTH_PERMISSIONS, permissions), "RequirePermissions");
var AllowReadOnlyMutation = /* @__PURE__ */ __name(() => (0, import_common.SetMetadata)(AUTH_READONLY_MUTATION, true), "AllowReadOnlyMutation");
var CurrentPrincipal = (0, import_common.createParamDecorator)((_, context) => context.switchToHttp().getRequest().user);
var CurrentSession = (0, import_common.createParamDecorator)((_, context) => context.switchToHttp().getRequest().authSession);

// src/nest/flowkit-auth.module.ts
var import_common6 = require("@nestjs/common");

// src/nest/principal.guard.ts
var import_common2 = require("@nestjs/common");
var import_core = require("@nestjs/core");

// src/errors.ts
var AuthError = class extends Error {
  static {
    __name(this, "AuthError");
  }
  code;
  details;
  name;
  constructor(code, message, details) {
    super(message), this.code = code, this.details = details, this.name = "AuthError";
  }
};

// src/nest/principal.guard.ts
function _ts_decorate(decorators, target, key, desc) {
  var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
  if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
  else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
  return c > 3 && r && Object.defineProperty(target, key, r), r;
}
__name(_ts_decorate, "_ts_decorate");
function _ts_metadata(k, v) {
  if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
__name(_ts_metadata, "_ts_metadata");
function _ts_param(paramIndex, decorator) {
  return function(target, key) {
    decorator(target, key, paramIndex);
  };
}
__name(_ts_param, "_ts_param");
var FlowkitPrincipalGuard = class {
  static {
    __name(this, "FlowkitPrincipalGuard");
  }
  reflector;
  resolver;
  constructor(reflector, resolver) {
    this.reflector = reflector;
    this.resolver = resolver;
  }
  async canActivate(context) {
    if (this.reflector.getAllAndOverride(AUTH_ANONYMOUS, [
      context.getHandler(),
      context.getClass()
    ])) return true;
    const request = context.switchToHttp().getRequest();
    if (!request.authUserId || !request.authSession) throw new import_common2.UnauthorizedException("Authentication required");
    try {
      request.user = await this.resolver.resolve({
        authUserId: request.authUserId,
        session: request.authSession
      });
      return true;
    } catch (error) {
      if (error instanceof AuthError && error.code === "unauthenticated") throw new import_common2.UnauthorizedException(error.message);
      throw error;
    }
  }
};
FlowkitPrincipalGuard = _ts_decorate([
  (0, import_common2.Injectable)(),
  _ts_param(1, (0, import_common2.Inject)(FLOWKIT_AUTH_PRINCIPAL_RESOLVER)),
  _ts_metadata("design:type", Function),
  _ts_metadata("design:paramtypes", [
    typeof import_core.Reflector === "undefined" ? Object : import_core.Reflector,
    Object
  ])
], FlowkitPrincipalGuard);

// src/nest/roles.guard.ts
var import_common3 = require("@nestjs/common");
var import_core2 = require("@nestjs/core");
function _ts_decorate2(decorators, target, key, desc) {
  var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
  if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
  else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
  return c > 3 && r && Object.defineProperty(target, key, r), r;
}
__name(_ts_decorate2, "_ts_decorate");
function _ts_metadata2(k, v) {
  if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
__name(_ts_metadata2, "_ts_metadata");
var FlowkitRolesGuard = class {
  static {
    __name(this, "FlowkitRolesGuard");
  }
  reflector;
  constructor(reflector) {
    this.reflector = reflector;
  }
  canActivate(context) {
    const roles = this.reflector.getAllAndOverride(AUTH_ROLES, [
      context.getHandler(),
      context.getClass()
    ]);
    if (!roles?.length) return true;
    const principal = context.switchToHttp().getRequest().user;
    if (!principal || !roles.includes(principal.role)) throw new import_common3.ForbiddenException("Role denied");
    return true;
  }
};
FlowkitRolesGuard = _ts_decorate2([
  (0, import_common3.Injectable)(),
  _ts_metadata2("design:type", Function),
  _ts_metadata2("design:paramtypes", [
    typeof import_core2.Reflector === "undefined" ? Object : import_core2.Reflector
  ])
], FlowkitRolesGuard);

// src/nest/permissions.guard.ts
var import_common4 = require("@nestjs/common");
var import_core3 = require("@nestjs/core");
function _ts_decorate3(decorators, target, key, desc) {
  var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
  if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
  else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
  return c > 3 && r && Object.defineProperty(target, key, r), r;
}
__name(_ts_decorate3, "_ts_decorate");
function _ts_metadata3(k, v) {
  if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
__name(_ts_metadata3, "_ts_metadata");
var FlowkitPermissionsGuard = class {
  static {
    __name(this, "FlowkitPermissionsGuard");
  }
  reflector;
  constructor(reflector) {
    this.reflector = reflector;
  }
  canActivate(context) {
    const permissions = this.reflector.getAllAndOverride(AUTH_PERMISSIONS, [
      context.getHandler(),
      context.getClass()
    ]);
    if (!permissions?.length) return true;
    const principal = context.switchToHttp().getRequest().user;
    if (!principal || permissions.some((permission) => !principal.permissions.includes(permission))) throw new import_common4.ForbiddenException("Permission denied");
    return true;
  }
};
FlowkitPermissionsGuard = _ts_decorate3([
  (0, import_common4.Injectable)(),
  _ts_metadata3("design:type", Function),
  _ts_metadata3("design:paramtypes", [
    typeof import_core3.Reflector === "undefined" ? Object : import_core3.Reflector
  ])
], FlowkitPermissionsGuard);

// src/nest/readonly.guard.ts
var import_common5 = require("@nestjs/common");
var import_core4 = require("@nestjs/core");
function _ts_decorate4(decorators, target, key, desc) {
  var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
  if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
  else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
  return c > 3 && r && Object.defineProperty(target, key, r), r;
}
__name(_ts_decorate4, "_ts_decorate");
function _ts_metadata4(k, v) {
  if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
__name(_ts_metadata4, "_ts_metadata");
var FlowkitReadonlyGuard = class {
  static {
    __name(this, "FlowkitReadonlyGuard");
  }
  reflector;
  constructor(reflector) {
    this.reflector = reflector;
  }
  canActivate(context) {
    if (this.reflector.getAllAndOverride(AUTH_READONLY_MUTATION, [
      context.getHandler(),
      context.getClass()
    ])) return true;
    const request = context.switchToHttp().getRequest();
    if (request.user?.readOnly && [
      "POST",
      "PUT",
      "PATCH",
      "DELETE"
    ].includes(request.method ?? "")) throw new import_common5.ForbiddenException("Readonly principal cannot mutate");
    return true;
  }
};
FlowkitReadonlyGuard = _ts_decorate4([
  (0, import_common5.Injectable)(),
  _ts_metadata4("design:type", Function),
  _ts_metadata4("design:paramtypes", [
    typeof import_core4.Reflector === "undefined" ? Object : import_core4.Reflector
  ])
], FlowkitReadonlyGuard);

// src/nest/flowkit-auth.module.ts
function _ts_decorate5(decorators, target, key, desc) {
  var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
  if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
  else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
  return c > 3 && r && Object.defineProperty(target, key, r), r;
}
__name(_ts_decorate5, "_ts_decorate");
var FlowkitAuthModule = class _FlowkitAuthModule {
  static {
    __name(this, "FlowkitAuthModule");
  }
  static forRootAsync(input) {
    const options = {
      provide: "FLOWKIT_AUTH_OPTIONS",
      inject: [
        ...input.inject ?? []
      ],
      useFactory: input.useFactory
    };
    const providers = [
      options,
      {
        provide: FLOWKIT_AUTH_RUNTIME,
        useFactory: /* @__PURE__ */ __name((value) => value.runtime, "useFactory"),
        inject: [
          "FLOWKIT_AUTH_OPTIONS"
        ]
      },
      {
        provide: FLOWKIT_AUTH_PRINCIPAL_RESOLVER,
        useFactory: /* @__PURE__ */ __name((value) => value.principalResolver, "useFactory"),
        inject: [
          "FLOWKIT_AUTH_OPTIONS"
        ]
      },
      {
        provide: FLOWKIT_AUTH_ROLE_REGISTRY,
        useFactory: /* @__PURE__ */ __name((value) => value.roleRegistry, "useFactory"),
        inject: [
          "FLOWKIT_AUTH_OPTIONS"
        ]
      },
      {
        provide: FLOWKIT_AUTH_AUDIT_SINK,
        useFactory: /* @__PURE__ */ __name((value) => value.auditSink, "useFactory"),
        inject: [
          "FLOWKIT_AUTH_OPTIONS"
        ]
      },
      FlowkitPrincipalGuard,
      FlowkitRolesGuard,
      FlowkitPermissionsGuard,
      FlowkitReadonlyGuard
    ];
    return {
      module: _FlowkitAuthModule,
      global: true,
      providers,
      exports: [
        FLOWKIT_AUTH_RUNTIME,
        FLOWKIT_AUTH_PRINCIPAL_RESOLVER,
        FLOWKIT_AUTH_ROLE_REGISTRY,
        FLOWKIT_AUTH_AUDIT_SINK,
        FlowkitPrincipalGuard,
        FlowkitRolesGuard,
        FlowkitPermissionsGuard,
        FlowkitReadonlyGuard
      ]
    };
  }
};
FlowkitAuthModule = _ts_decorate5([
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
