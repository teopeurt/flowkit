import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AUTH_PERMISSIONS } from './decorators';
import type { AuthenticatedPrincipal } from '../principal';
@Injectable()
export class FlowkitPermissionsGuard implements CanActivate { constructor(private readonly reflector: Reflector) {} canActivate(context: ExecutionContext) { const permissions = this.reflector.getAllAndOverride<readonly string[]>(AUTH_PERMISSIONS, [context.getHandler(), context.getClass()]); if (!permissions?.length) return true; const principal = context.switchToHttp().getRequest<{ user?: AuthenticatedPrincipal }>().user; if (!principal || permissions.some(permission => !principal.permissions.includes(permission))) throw new ForbiddenException('Permission denied'); return true; } }
