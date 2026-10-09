import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { authenticator } from 'otplib';
import { PrismaService } from '../prisma/prisma.service';

/** Les rôles administrateurs doivent obligatoirement avoir la 2FA activée. */
export const ADMIN_ROLES: Role[] = [Role.SUPER_ADMIN, Role.INSTITUTION_ADMIN, Role.ELECTION_COMMISSIONER];

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  hashPassword(password: string) {
    return bcrypt.hash(password, 12);
  }

  async login(email: string, password: string, totp?: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    // Message identique dans tous les cas d'échec : pas d'énumération de comptes.
    const invalid = new UnauthorizedException('Invalid credentials');
    if (!user || !user.isActive || !(await bcrypt.compare(password, user.passwordHash))) throw invalid;

    if (user.twoFactorEnabled) {
      if (!totp || !user.twoFactorSecret || !authenticator.check(totp, user.twoFactorSecret)) throw invalid;
    } else if (ADMIN_ROLES.includes(user.role)) {
      // Admin sans 2FA : seul l'enrôlement est autorisé (jeton restreint).
      return { twoFactorSetupRequired: true as const, setupToken: await this.signSetupToken(user) };
    }
    return this.issueTokens(user);
  }

  async refresh(refreshToken: string) {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: true },
    });
    if (!record || record.expiresAt < new Date() || !record.user.isActive) throw new UnauthorizedException();
    if (record.revokedAt) {
      // Réutilisation d'un jeton déjà tourné : vol probable → on révoque toute la session.
      await this.prisma.refreshToken.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException();
    }
    await this.prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
    return this.issueTokens(record.user);
  }

  async logout(refreshToken: string) {
    await this.prisma.refreshToken.updateMany({ where: { tokenHash: sha256(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async setupTwoFactor(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.twoFactorEnabled) throw new BadRequestException('2FA already enabled');
    const secret = authenticator.generateSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorSecret: secret } });
    return { secret, otpauthUrl: authenticator.keyuri(user.email, this.config.get('TWO_FACTOR_ISSUER', 'Elections'), secret) };
  }

  async enableTwoFactor(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.twoFactorSecret || !authenticator.check(code, user.twoFactorSecret)) throw new BadRequestException('Invalid code');
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
    return this.issueTokens({ ...user, twoFactorEnabled: true });
  }

  private signSetupToken(user: User) {
    return this.jwt.signAsync({ sub: user.id, role: user.role, institutionId: user.institutionId, typ: 'setup' }, { expiresIn: '10m' });
  }

  private async issueTokens(user: User) {
    const accessToken = await this.jwt.signAsync({ sub: user.id, role: user.role, institutionId: user.institutionId, typ: 'access' });
    const refreshToken = randomBytes(48).toString('base64url');
    const days = this.config.get<number>('REFRESH_TTL_DAYS', 7);
    await this.prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: sha256(refreshToken), expiresAt: new Date(Date.now() + days * 86_400_000) },
    });
    return { accessToken, refreshToken };
  }
}
