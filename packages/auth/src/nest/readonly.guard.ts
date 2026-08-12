import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AUTH_READONLY_MUTATION } from './decorators';
import type { AuthenticatedPrincipal } from '../principal';
@Injectable()
export class FlowkitReadonlyGuard implements CanActivate { constructor(private readonly reflector: Reflector) {} canActivate(context: ExecutionContext) { if (this.reflector.getAllAndOverride<boolean>(AUTH_READONLY_MUTATION, [context.getHandler(), context.getClass()])) return true; const request = context.switchToHttp().getRequest<{ user?: AuthenticatedPrincipal; method?: string }>(); if (request.user?.readOnly && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method ?? '')) throw new ForbiddenException('Readonly principal cannot mutate'); return true; } }
