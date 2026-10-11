import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Role, PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { AuditService } from '../../src/audit/audit.service';

// Parcours d'authentification et de rôles contre la VRAIE base : unicité réelle, transactions, rotation concurrente.
describe('Authentification sur la vraie base MySQL', () => {
  const run = Math.random().toString(36).slice(2, 8);
  const prisma = new PrismaClient();
  let app: NestExpressApplication;
  let instId: string;
  let n = 0;
  const api = (method: 'get' | 'post', path: string) =>
    request(app.getHttpServer())[method](`/api/v1${path}`).set('x-forwarded-for', `10.9.${Math.floor(++n / 250)}.${n % 250}`).set('x-requested-with', 'XMLHttpRequest');
  const cookieOf = (res: request.Response) => /refresh_token=([^;]+)/.exec(String(res.headers['set-cookie']?.[0] ?? ''))?.[1] ?? '';
  const password = 'Un-mot-de-passe-solide-1';

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication<NestExpressApplication>();
    configureApp(app, { trustProxy: 1 });
    await app.init();
    instId = (await prisma.institution.create({ data: { code: `T${run}`.toUpperCase(), name: `Institution de test ${run}` } })).id;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('inscriptions simultanées du même e-mail : un seul compte, toutes les réponses identiques (202)', async () => {
    const email = `dup-${run}@example.test`;
    const res = await Promise.all(
      Array.from({ length: 12 }, () => api('post', '/auth/register').send({ email, password, institutionCode: `T${run}`.toUpperCase() })),
    );
    expect(new Set(res.map((r) => r.status))).toEqual(new Set([202]));
    expect(await prisma.user.count({ where: { email } })).toBe(1);
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { roles: true } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.roles).toEqual([expect.objectContaining({ role: Role.STUDENT, institutionId: instId })]);
  });

  it('rotation du refresh token : un rejeu révoque la session ; deux renouvellements simultanés du même cookie : un seul gagne', async () => {
    const email = `rot-${run}@example.test`;
    await api('post', '/auth/register').send({ email, password, institutionCode: `T${run}`.toUpperCase() });
    const login = await api('post', '/auth/login').send({ identifier: email, password }).expect(200);
    const first = cookieOf(login);

    const rotated = await api('post', '/auth/refresh').set('cookie', `refresh_token=${first}`).expect(200);
    const second = cookieOf(rotated);
    await api('post', '/auth/refresh').set('cookie', `refresh_token=${first}`).expect(401); // rejeu
    await api('post', '/auth/refresh').set('cookie', `refresh_token=${second}`).expect(401); // famille révoquée
    await api('get', '/users/me').set('authorization', `Bearer ${rotated.body.accessToken}`).expect(401);

    // Concurrence réelle : le même cookie présenté deux fois en même temps (deux onglets sans coordination).
    const login2 = await api('post', '/auth/login').send({ identifier: email, password }).expect(200);
    const c = cookieOf(login2);
    const both = await Promise.all([
      api('post', '/auth/refresh').set('cookie', `refresh_token=${c}`),
      api('post', '/auth/refresh').set('cookie', `refresh_token=${c}`),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it('SUPER_ADMIN : 2FA obligatoire (D-15), step-up, attribution et révocation de rôle, tout tracé dans une chaîne intègre', async () => {
    const saEmail = `sa-${run}@example.test`;
    await prisma.user.create({
      data: { email: saEmail, passwordHash: await argon2.hash(password), roles: { create: { role: Role.SUPER_ADMIN } } },
    });
    const first = await api('post', '/auth/login').send({ identifier: saEmail, password }).expect(200);
    expect(first.body.status).toBe('two_factor_setup_required');
    const setupAuth = `Bearer ${first.body.setupToken}`;
    await api('get', '/users/me').set('authorization', setupAuth).expect(401); // le jeton de configuration n'ouvre rien d'autre
    const setup = await api('post', '/auth/2fa/setup').set('authorization', setupAuth).expect(200);
    const enabled = await api('post', '/auth/2fa/enable').set('authorization', setupAuth).send({ code: authenticator.generate(setup.body.secret) }).expect(200);
    await api('post', '/auth/2fa/enable').set('authorization', setupAuth).send({ code: authenticator.generate(setup.body.secret) }).expect(401); // usage unique
    const token = `Bearer ${enabled.body.accessToken}`;

    const target = `ia-${run}@example.test`;
    await api('post', '/auth/register').send({ email: target, password, institutionCode: `T${run}`.toUpperCase() });
    const granted = await api('post', `/institutions/${instId}/roles`).set('authorization', token).send({ email: target, role: 'INSTITUTION_ADMIN' }).expect(201);
    await api('post', `/institutions/${instId}/roles/${granted.body.assignmentId}/revoke`).set('authorization', token).expect(204);
    expect(await prisma.roleAssignment.count({ where: { id: granted.body.assignmentId, revokedAt: { not: null } } })).toBe(1);

    const audit = app.get(AuditService);
    expect(await audit.verifyChain()).toEqual(expect.objectContaining({ valid: true }));
    const actions = (await prisma.auditLog.findMany({ select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['TWO_FACTOR_SETUP_TOKEN_ISSUED', 'TWO_FACTOR_SETUP_TOKEN_USED', 'ROLE_ASSIGNED', 'ROLE_REVOKED']));
  });
});
