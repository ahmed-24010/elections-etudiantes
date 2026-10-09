import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const secret = authenticator.generateSecret();
  let prisma: any;
  let service: AuthService;
  let user: any;

  beforeEach(async () => {
    user = {
      id: 'u1', email: 'a@x.tn', role: 'STUDENT', institutionId: null, isActive: true,
      passwordHash: await bcrypt.hash('password123', 4), twoFactorEnabled: false, twoFactorSecret: null,
    };
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(user) },
      refreshToken: {
        create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn(),
      },
    };
    const jwt = new JwtService({ secret: 'x'.repeat(32) });
    const config: any = { get: (_k: string, d: unknown) => d };
    service = new AuthService(prisma, jwt, config);
  });

  it('connecte un étudiant et stocke uniquement le hash du refresh token', async () => {
    const res: any = await service.login('A@x.tn', 'password123');
    expect(res.accessToken).toBeDefined();
    const stored = prisma.refreshToken.create.mock.calls[0][0].data.tokenHash;
    expect(stored).not.toBe(res.refreshToken);
    expect(stored).toHaveLength(64);
  });

  it('refuse un mauvais mot de passe', async () => {
    await expect(service.login('a@x.tn', 'wrong-password')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('impose l’enrôlement 2FA à un admin sans 2FA (aucun jeton d’accès)', async () => {
    user.role = 'SUPER_ADMIN';
    const res: any = await service.login('a@x.tn', 'password123');
    expect(res.twoFactorSetupRequired).toBe(true);
    expect(res.accessToken).toBeUndefined();
  });

  it('exige un code TOTP valide quand la 2FA est activée', async () => {
    Object.assign(user, { role: 'SUPER_ADMIN', twoFactorEnabled: true, twoFactorSecret: secret });
    await expect(service.login('a@x.tn', 'password123')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.login('a@x.tn', 'password123', '000000')).rejects.toBeInstanceOf(UnauthorizedException);
    const res: any = await service.login('a@x.tn', 'password123', authenticator.generate(secret));
    expect(res.accessToken).toBeDefined();
  });

  it('révoque toutes les sessions si un refresh token déjà utilisé est rejoué', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'r1', userId: 'u1', expiresAt: new Date(Date.now() + 1e6), revokedAt: new Date(), user,
    });
    await expect(service.refresh('old')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1', revokedAt: null } }));
  });
});
