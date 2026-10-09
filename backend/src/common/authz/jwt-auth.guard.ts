import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser, RoleGrant } from './auth-user';
import { ADMIN_ROLES } from './permissions';
import { ALLOW_SETUP_TOKEN, IS_PUBLIC } from './decorators';
import type { AuthedRequest } from './request-context';

export interface AccessPayload { sub: string; sid: string; typ: 'access' }
export interface SetupPayload { sub: string; jti: string; typ: 'setup' }

const toGrants = (roles: RoleGrant[]): RoleGrant[] =>
  roles.map((r) => ({ id: r.id, role: r.role, institutionId: r.institutionId, electionId: r.electionId }));

/**
 * Vérifie le jeton et RELIT l'utilisateur, ses rôles actifs et sa session en base à chaque requête :
 * une révocation de rôle ou de session est donc effective immédiatement (03 §7.4, D-18).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException();

    const access = await this.verify<AccessPayload>(token, this.config.getOrThrow('JWT_ACCESS_SECRET'));
    if (access?.typ === 'access' && access.sub && access.sid) {
      req.user = await this.loadSession(access);
      return true;
    }
    // Le jeton de configuration 2FA (D-15) n'est accepté que sur les routes qui l'autorisent explicitement.
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_SETUP_TOKEN, targets)) {
      const setup = await this.verify<SetupPayload>(token, this.config.getOrThrow('JWT_REFRESH_SECRET'));
      if (setup?.typ === 'setup' && setup.sub && setup.jti) {
        req.user = await this.loadSetupUser(setup);
        return true;
      }
    }
    throw new UnauthorizedException();
  }

  private async verify<T extends object>(token: string, secret: string): Promise<T | null> {
    try {
      return await this.jwt.verifyAsync<T>(token, { secret });
    } catch {
      return null;
    }
  }

  private async loadSession(p: AccessPayload): Promise<AuthUser> {
    const session = await this.prisma.refreshToken.findFirst({
      where: { familyId: p.sid, userId: p.sub, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { user: { include: { roles: { where: { revokedAt: null } } } } },
    });
    if (!session || session.user.status !== UserStatus.ACTIVE) throw new UnauthorizedException();
    // D-10 : sans 2FA active, les rôles administratifs ne comptent pas (ex. un étudiant déjà connecté à qui l'on vient
    // d'attribuer un rôle d'admin). Il doit passer par la connexion + jeton de configuration (D-15).
    const roles = session.user.twoFactorEnabled
      ? session.user.roles
      : session.user.roles.filter((r) => !ADMIN_ROLES.includes(r.role));
    return {
      id: session.user.id,
      twoFactorEnabled: session.user.twoFactorEnabled,
      sessionId: p.sid,
      twoFactorVerifiedAt: session.twoFactorVerifiedAt,
      setupOnly: false,
      roles: toGrants(roles),
    };
  }

  private async loadSetupUser(p: SetupPayload): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: p.sub },
      include: { roles: { where: { revokedAt: null } } },
    });
    // Usage unique : le jti doit être celui mémorisé en base (effacé à l'activation de la 2FA).
    if (!user || user.status !== UserStatus.ACTIVE || user.setupTokenJti !== p.jti) throw new UnauthorizedException();
    return {
      id: user.id,
      twoFactorEnabled: user.twoFactorEnabled,
      sessionId: '',
      twoFactorVerifiedAt: null,
      setupOnly: true,
      roles: toGrants(user.roles),
    };
  }
}
