import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AUTH_ANONYMOUS } from './decorators';
import { FLOWKIT_AUTH_PRINCIPAL_RESOLVER } from './tokens';
import { AuthError } from '../errors';
@Injectable()
export class FlowkitPrincipalGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, @Inject(FLOWKIT_AUTH_PRINCIPAL_RESOLVER) private readonly resolver: { resolve(input: { authUserId: string; session: unknown }): Promise<unknown> }) {}
  async canActivate(context: ExecutionContext) { if (this.reflector.getAllAndOverride<boolean>(AUTH_ANONYMOUS, [context.getHandler(), context.getClass()])) return true; const request = context.switchToHttp().getRequest<{ authUserId?: string; authSession?: unknown; user?: unknown }>(); if (!request.authUserId || !request.authSession) throw new UnauthorizedException('Authentication required'); try { request.user = await this.resolver.resolve({ authUserId: request.authUserId, session: request.authSession }); return true; } catch (error) { if (error instanceof AuthError && error.code === 'unauthenticated') throw new UnauthorizedException(error.message); throw error; } }
}
