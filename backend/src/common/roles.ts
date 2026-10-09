import { CanActivate, ExecutionContext, ForbiddenException, SetMetadata, UnauthorizedException, Injectable, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';

export const IS_PUBLIC = 'isPublic';
export const ROLES_KEY = 'roles';

export const ALLOW_SETUP = 'allowSetupToken';

export const Public = () => SetMetadata(IS_PUBLIC, true);
export const AllowSetupToken = () => SetMetadata(ALLOW_SETUP, true);
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export interface AuthUser {
  sub: string;
  role: Role;
  institutionId: string | null;
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

/** Guard global : exige un access token valide sauf routes @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;
    const req = context.switchToHttp().getRequest();
    const [type, token] = (req.headers.authorization ?? '').split(' ');
    if (type !== 'Bearer' || !token) throw new UnauthorizedException();
    try {
      const payload = await this.jwt.verifyAsync<AuthUser & { typ?: string }>(token);
      // Le jeton "setup" (admin sans 2FA) n'ouvre que les routes @AllowSetupToken().
      const allowSetup = this.reflector.getAllAndOverride<boolean>(ALLOW_SETUP, [context.getHandler(), context.getClass()]);
      if (payload.typ !== 'access' && !(payload.typ === 'setup' && allowSetup)) throw new Error('wrong token type');
      req.user = { sub: payload.sub, role: payload.role, institutionId: payload.institutionId };
    } catch {
      throw new UnauthorizedException();
    }
    return true;
  }
}

/** Guard global : si @Roles() est présent, le rôle de l'utilisateur doit y figurer. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!required?.length) return true;
    const user: AuthUser | undefined = context.switchToHttp().getRequest().user;
    if (!user || !required.includes(user.role)) throw new ForbiddenException();
    return true;
  }
}
