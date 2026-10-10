import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuditResult, Prisma, Role, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/authz/auth-user';
import { ADMIN_ROLES } from '../common/authz/permissions';
import { PrismaService } from '../prisma/prisma.service';
import type { LoginDto, RegisterDto } from './dto/auth.dto';
import { LoginAttemptLimiter } from './login-attempt.limiter';
import { TwoFactorService } from './two-factor.service';

export interface RequestInfo {
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export type LoginResult =
  | { status: 'authenticated'; session: Session }
  | { status: 'two_factor_required' }
  | { status: 'two_factor_setup_required'; setupToken: string };

export const SETUP_TOKEN_TTL = '10m'; // D-15

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const INVALID = 'invalid_credentials';

@Injectable()
export class AuthService {
  // Hash factice pour que « compte inconnu » coûte aussi un calcul Argon2 (pas d'énumération par le temps de réponse).
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly twoFactor: TwoFactorService,
    private readonly limiter: LoginAttemptLimiter,
  ) {}

  hashPassword(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  // ------------------------------------------------------------------ inscription

  /**
   * Inscription étudiante. La réponse est identique que l'e-mail / le téléphone existent déjà ou non
   * (aucune énumération de comptes) ; l'unicité est garantie par les index uniques de la base.
   */
  async register(dto: RegisterDto, info: RequestInfo): Promise<void> {
    const email = dto.email?.trim().toLowerCase() || undefined;
    const phone = dto.phone ? this.normalizePhone(dto.phone) : undefined;
    if (!email && !phone) throw new BadRequestException('email_or_phone_required');

    const institution = await this.prisma.institution.findFirst({
      where: { code: dto.institutionCode, isActive: true },
      select: { id: true },
    });
    if (!institution) throw new BadRequestException('invalid_institution');

    const passwordHash = await this.hashPassword(dto.password);
    try {
      const user = await this.prisma.user.create({
        data: {
          email,
          phone,
          passwordHash,
          roles: { create: { role: Role.STUDENT, institutionId: institution.id } },
        },
        select: { id: true },
      });
      await this.audit.record({
        actorId: user.id,
        actorRole: Role.STUDENT,
        institutionId: institution.id,
        action: 'USER_REGISTERED',
        resourceType: 'user',
        resourceId: user.id,
        result: AuditResult.SUCCESS,
        ip: info.ip,
        requestId: info.requestId,
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      await this.audit.record({
        institutionId: institution.id,
        action: 'USER_REGISTER_DUPLICATE',
        resourceType: 'user',
        result: AuditResult.FAILURE,
        ip: info.ip,
        requestId: info.requestId,
      });
    }
  }

  private normalizePhone(phone: string): string {
    return phone.replace(/[\s.-]/g, '');
  }

  // ------------------------------------------------------------------ connexion

  async login(dto: LoginDto, info: RequestInfo): Promise<LoginResult> {
    const identifier = dto.identifier.trim();
    const user = await this.prisma.user.findUnique({
      where: identifier.includes('@') ? { email: identifier.toLowerCase() } : { phone: this.normalizePhone(identifier) },
      include: { roles: { where: { revokedAt: null }, select: { role: true } } },
    });

    const passwordOk = await argon2.verify(user?.passwordHash ?? (await this.getDummyHash()), dto.password).catch(() => false);
    const locked = user ? this.limiter.isLocked(user.id) : false;
    if (!user || !passwordOk || user.status !== UserStatus.ACTIVE || locked) {
      if (user) this.limiter.fail(user.id);
      await this.auditLogin(AuditResult.FAILURE, user?.id, info, locked ? 'locked' : 'bad_credentials');
      throw new UnauthorizedException(INVALID);
    }

    if (user.twoFactorEnabled) {
      if (!dto.totp) return { status: 'two_factor_required' };
      if (!this.twoFactor.verify(user.twoFactorSecretEnc, dto.totp)) {
        this.limiter.fail(user.id);
        await this.auditLogin(AuditResult.FAILURE, user.id, info, 'bad_two_factor');
        throw new UnauthorizedException(INVALID);
      }
      this.limiter.reset(user.id);
      const session = await this.createSession(user.id, info, true);
      await this.markLogin(user.id, info);
      return { status: 'authenticated', session };
    }

    if (user.roles.some((r) => ADMIN_ROLES.includes(r.role))) {
      // D-15 : pas de jeton d'accès sans 2FA pour un compte administratif ; un jeton de configuration, une seule fois.
      this.limiter.reset(user.id);
      const jti = randomUUID();
      await this.prisma.user.update({ where: { id: user.id }, data: { setupTokenJti: jti } });
      const setupToken = await this.jwt.signAsync(
        { sub: user.id, jti, typ: 'setup' },
        { secret: this.config.getOrThrow('JWT_REFRESH_SECRET'), expiresIn: SETUP_TOKEN_TTL },
      );
      await this.audit.record({
        actorId: user.id,
        action: 'TWO_FACTOR_SETUP_TOKEN_ISSUED',
        resourceType: 'user',
        resourceId: user.id,
        result: AuditResult.SUCCESS,
        ip: info.ip,
        requestId: info.requestId,
      });
      return { status: 'two_factor_setup_required', setupToken };
    }

    this.limiter.reset(user.id);
    const session = await this.createSession(user.id, info, false);
    await this.markLogin(user.id, info);
    return { status: 'authenticated', session };
  }

  private async markLogin(userId: string, info: RequestInfo) {
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    await this.auditLogin(AuditResult.SUCCESS, userId, info);
  }

  private auditLogin(result: AuditResult, userId: string | undefined, info: RequestInfo, reason?: string) {
    return this.audit.record({
      actorId: userId,
      action: 'LOGIN',
      resourceType: 'user',
      resourceId: userId,
      result,
      ip: info.ip,
      requestId: info.requestId,
      metadata: reason ? { reason } : null,
    });
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.hashPassword(randomBytes(16).toString('hex'));
    return this.dummyHash;
  }

  // ------------------------------------------------------------------ sessions

  /** Nouvelle session = nouvelle famille de refresh tokens. */
  async createSession(userId: string, info: RequestInfo, twoFactorVerified: boolean, familyId = randomUUID()): Promise<Session> {
    const { token, expiresAt } = await this.insertRefreshToken(userId, familyId, info, twoFactorVerified ? new Date() : null);
    return { accessToken: await this.signAccess(userId, familyId), refreshToken: token, refreshExpiresAt: expiresAt };
  }

  private signAccess(userId: string, familyId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, sid: familyId, typ: 'access' },
      { secret: this.config.getOrThrow('JWT_ACCESS_SECRET'), expiresIn: this.config.get('JWT_ACCESS_TTL', '15m') },
    );
  }

  private async insertRefreshToken(
    userId: string,
    familyId: string,
    info: RequestInfo,
    twoFactorVerifiedAt: Date | null,
    id: string = randomUUID(),
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const token = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + this.config.get<number>('REFRESH_TTL_DAYS', 7) * 86_400_000);
    await db.refreshToken.create({
      data: { id, userId, familyId, tokenHash: sha256(token), expiresAt, userAgent: info.userAgent?.slice(0, 255), twoFactorVerifiedAt },
    });
    return { token, expiresAt };
  }

  /**
   * Rotation : chaque refresh token ne sert qu'une fois. Présenter un token déjà consommé signale un vol probable :
   * toute la famille (la session) est révoquée.
   */
  async refresh(refreshToken: string | undefined, info: RequestInfo): Promise<Session> {
    if (!refreshToken) throw new UnauthorizedException();
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: { select: { status: true } } },
    });
    if (!record) throw new UnauthorizedException();

    if (record.revokedAt) {
      await this.revokeFamily(record.familyId);
      // Un token révoqué par déconnexion (sans remplaçant) n'est pas un signe de vol ; un token remplacé, si.
      if (record.replacedById) await this.auditReuse(record.userId, record.familyId, info);
      throw new UnauthorizedException();
    }
    if (record.expiresAt <= new Date() || record.user.status !== UserStatus.ACTIVE) throw new UnauthorizedException();

    const newId = randomUUID();
    let next: { token: string; expiresAt: Date } | null = null;
    await this.prisma.$transaction(async (tx) => {
      // Consommation atomique : si deux requêtes présentent le même token, une seule gagne.
      const consumed = await tx.refreshToken.updateMany({
        where: { id: record.id, revokedAt: null },
        data: { revokedAt: new Date(), replacedById: newId },
      });
      if (consumed.count !== 1) return;
      next = await this.insertRefreshToken(record.userId, record.familyId, info, record.twoFactorVerifiedAt, newId, tx);
    });
    if (!next) {
      await this.revokeFamily(record.familyId);
      await this.auditReuse(record.userId, record.familyId, info);
      throw new UnauthorizedException();
    }
    const { token, expiresAt } = next as { token: string; expiresAt: Date };
    return { accessToken: await this.signAccess(record.userId, record.familyId), refreshToken: token, refreshExpiresAt: expiresAt };
  }

  private auditReuse(userId: string, familyId: string, info: RequestInfo) {
    return this.audit.record({
      actorId: userId,
      action: 'REFRESH_TOKEN_REUSE_DETECTED',
      resourceType: 'session',
      resourceId: familyId,
      result: AuditResult.DENIED,
      ip: info.ip,
      requestId: info.requestId,
    });
  }

  async logout(refreshToken: string | undefined, info: RequestInfo): Promise<void> {
    if (!refreshToken) return;
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (!record) return;
    await this.revokeFamily(record.familyId);
    await this.audit.record({
      actorId: record.userId,
      action: 'LOGOUT',
      resourceType: 'session',
      resourceId: record.familyId,
      result: AuditResult.SUCCESS,
      ip: info.ip,
      requestId: info.requestId,
    });
  }

  revokeFamily(familyId: string) {
    return this.prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  // ------------------------------------------------------------------ 2FA

  /** Démarre la configuration : génère un secret (chiffré en base) et renvoie l'URI à scanner. */
  async startTwoFactorSetup(actor: AuthUser, info: RequestInfo) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (user.twoFactorEnabled) throw new ConflictException('two_factor_already_enabled');
    const generated = this.twoFactor.newSecret(user.email ?? user.phone ?? user.id);
    await this.prisma.user.update({ where: { id: user.id }, data: { twoFactorSecretEnc: generated.encrypted } });
    await this.audit.record({
      actorId: user.id,
      action: 'TWO_FACTOR_SETUP_STARTED',
      resourceType: 'user',
      resourceId: user.id,
      result: AuditResult.SUCCESS,
      ip: info.ip,
      requestId: info.requestId,
    });
    return { secret: generated.secret, otpauthUri: generated.otpauthUri };
  }

  /**
   * Active la 2FA. Avec le jeton de configuration (D-15), c'est son usage unique : le jti est effacé et la connexion
   * se termine par l'ouverture d'une vraie session. Avec un jeton d'accès (étudiant), la session courante est marquée « 2FA vérifiée ».
   */
  async enableTwoFactor(actor: AuthUser, code: string, info: RequestInfo): Promise<Session | null> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (user.twoFactorEnabled) throw new ConflictException('two_factor_already_enabled');
    if (this.limiter.isLocked(user.id) || !this.twoFactor.verify(user.twoFactorSecretEnc, code)) {
      this.limiter.fail(user.id);
      await this.audit.record({
        actorId: user.id,
        action: 'TWO_FACTOR_ENABLE',
        resourceType: 'user',
        resourceId: user.id,
        result: AuditResult.FAILURE,
        ip: info.ip,
        requestId: info.requestId,
      });
      throw new BadRequestException('invalid_code');
    }
    this.limiter.reset(user.id);
    await this.prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true, setupTokenJti: null } });
    await this.audit.record({
      actorId: user.id,
      action: actor.setupOnly ? 'TWO_FACTOR_SETUP_TOKEN_USED' : 'TWO_FACTOR_ENABLE',
      resourceType: 'user',
      resourceId: user.id,
      result: AuditResult.SUCCESS,
      ip: info.ip,
      requestId: info.requestId,
    });
    if (actor.setupOnly) {
      const session = await this.createSession(user.id, info, true);
      await this.markLogin(user.id, info);
      return session;
    }
    await this.prisma.refreshToken.updateMany({
      where: { familyId: actor.sessionId, revokedAt: null },
      data: { twoFactorVerifiedAt: new Date() },
    });
    return null;
  }

  /** Step-up : prouve la possession du TOTP pour les 10 minutes suivantes (StepUpGuard). */
  async stepUp(actor: AuthUser, code: string, info: RequestInfo): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (!user.twoFactorEnabled) throw new ConflictException('two_factor_not_enabled');
    const ok = !this.limiter.isLocked(user.id) && this.twoFactor.verify(user.twoFactorSecretEnc, code);
    await this.audit.record({
      actorId: user.id,
      action: 'STEP_UP',
      resourceType: 'session',
      resourceId: actor.sessionId,
      result: ok ? AuditResult.SUCCESS : AuditResult.FAILURE,
      ip: info.ip,
      requestId: info.requestId,
    });
    if (!ok) {
      this.limiter.fail(user.id);
      throw new BadRequestException('invalid_code');
    }
    this.limiter.reset(user.id);
    await this.prisma.refreshToken.updateMany({
      where: { familyId: actor.sessionId, revokedAt: null },
      data: { twoFactorVerifiedAt: new Date() },
    });
  }
}
