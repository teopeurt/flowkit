import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AUTH_ROLES } from './decorators';
import type { AuthenticatedPrincipal } from '../principal';
@Injectable()
export class FlowkitRolesGuard implements CanActivate { constructor(private readonly reflector: Reflector) {} canActivate(context: ExecutionContext) { const roles = this.reflector.getAllAndOverride<readonly string[]>(AUTH_ROLES, [context.getHandler(), context.getClass()]); if (!roles?.length) return true; const principal = context.switchToHttp().getRequest<{ user?: AuthenticatedPrincipal }>().user; if (!principal || !roles.includes(principal.role)) throw new ForbiddenException('Role denied'); return true; } }
