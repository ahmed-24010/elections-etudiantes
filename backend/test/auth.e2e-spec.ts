import { authenticator } from 'otplib';
import { Role } from '@prisma/client';
import { createHash } from 'crypto';
import { SecretCipher } from '../src/common/crypto/secret-cipher';
import { bearer, createTestApp, PASSWORD, TestContext } from './helpers';

const cookieOf = (res: { headers: Record<string, any> }): string => String(res.headers['set-cookie']?.[0] ?? '');
const refreshValue = (setCookie: string) => /refresh_token=([^;]+)/.exec(setCookie)?.[1] ?? '';

describe('Authentification (e2e)', () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.app.close());

  describe('inscription', () => {
    const body = { email: 'Alice@Example.test', password: 'a-long-enough-password', institutionCode: 'AAA' };

    it("répond 202 identique que l'e-mail soit nouveau ou déjà pris (pas d'énumération)", async () => {
      const first = await t.api('post', '/auth/register').send(body);
      const again = await t.api('post', '/auth/register').send(body);
      const phoneTaken = await t.api('post', '/auth/register').send({ ...body, email: 'autre@example.test', phone: '+21612345678' });
      const phoneAgain = await t.api('post', '/auth/register').send({ ...body, email: 'autre2@example.test', phone: '+216 12 345 678' });
      expect([first.status, again.status, phoneTaken.status, phoneAgain.status]).toEqual([202, 202, 202, 202]);
      expect(again.body).toEqual(first.body);
      expect(phoneAgain.body).toEqual(first.body);
      expect(t.prisma.users.filter((u) => u.email === 'alice@example.test')).toHaveLength(1);
      expect(t.prisma.users.filter((u) => u.phone === '+21612345678')).toHaveLength(1);
    });

    it('crée un compte STUDENT rattaché à l’institution, mot de passe haché en Argon2id', async () => {
      const user = t.prisma.users.find((u) => u.email === 'alice@example.test')!;
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(user.passwordHash).not.toContain(body.password);
      const grants = t.prisma.roleAssignments.filter((r) => r.userId === user.id);
      expect(grants).toEqual([expect.objectContaining({ role: Role.STUDENT, institutionId: t.world.instA.id })]);
    });

    it('refuse un mot de passe de moins de 10 caractères, une institution inconnue ou inactive', async () => {
      await t.api('post', '/auth/register').send({ ...body, password: '123456789' }).expect(400);
      await t.api('post', '/auth/register').send({ ...body, email: 'z@example.test', institutionCode: 'NOPE' }).expect(400);
      t.world.instB.isActive = false;
      await t.api('post', '/auth/register').send({ ...body, email: 'z@example.test', institutionCode: 'BBB' }).expect(400);
      t.world.instB.isActive = true;
      await t.api('post', '/auth/register').send({ password: body.password, institutionCode: 'AAA' }).expect(400);
    });

    it('refuse les champs inconnus (whitelist) : pas de rôle ni de statut imposés par le client', async () => {
      await t.api('post', '/auth/register').send({ ...body, email: 'evil@example.test', role: 'SUPER_ADMIN' }).expect(400);
    });

    it('la liste publique des institutions ne contient que le code et le nom', async () => {
      const res = await t.api('get', '/institutions/public').expect(200);
      expect(res.body).toEqual(expect.arrayContaining([{ code: 'AAA', name: 'Institution A' }]));
      for (const i of res.body) expect(Object.keys(i).sort()).toEqual(['code', 'name']);
    });
  });

  describe('connexion étudiante, refresh et déconnexion', () => {
    let refresh: string;
    let access: string;

    beforeAll(async () => {
      await t.world.addUser('student1@example.test', [{ role: Role.STUDENT, institutionId: t.world.instA.id }]);
    });

    it("message identique pour compte inconnu et mauvais mot de passe", async () => {
      const unknown = await t.api('post', '/auth/login').send({ identifier: 'inconnu@example.test', password: PASSWORD });
      const wrong = await t.api('post', '/auth/login').send({ identifier: 'student1@example.test', password: 'mauvais-mot-de-passe' });
      expect(unknown.status).toBe(401);
      expect(wrong.status).toBe(401);
      expect(unknown.body.message).toBe(wrong.body.message);
    });

    it('connecte : jeton d’accès dans le corps, refresh token UNIQUEMENT dans un cookie HttpOnly', async () => {
      const res = await t.api('post', '/auth/login').send({ identifier: 'Student1@Example.test', password: PASSWORD }).expect(200);
      expect(res.body.status).toBe('authenticated');
      expect(JSON.stringify(res.body)).not.toContain('refresh');
      const cookie = cookieOf(res);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
      expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
      access = res.body.accessToken;
      refresh = refreshValue(cookie);
      expect(refresh.length).toBeGreaterThan(40);
      await t.api('get', '/users/me').set('authorization', bearer(access)).expect(200);
    });

    it('ne stocke que le hash SHA-256 du refresh token', () => {
      const stored = t.prisma.refreshTokens.map((r) => r.tokenHash);
      expect(stored).toContain(createHash('sha256').update(refresh).digest('hex'));
      expect(stored).not.toContain(refresh);
    });

    it('refresh exige l’en-tête personnalisé X-Requested-With (défense CSRF)', async () => {
      const bare = await t.api('post', '/auth/refresh').set('x-requested-with', '').set('cookie', `refresh_token=${refresh}`);
      expect(bare.status).toBe(403);
      // Le refus ne consomme pas le token.
      await t.api('post', '/auth/refresh').set('cookie', `refresh_token=${refresh}`).expect(200).then((r) => {
        refresh = refreshValue(cookieOf(r));
        access = r.body.accessToken;
      });
    });

    it('rotation : le nouveau token fonctionne, l’ancien est refusé et la RÉUTILISATION révoque toute la session', async () => {
      const used = refresh;
      const rotated = await t.api('post', '/auth/refresh').set('cookie', `refresh_token=${used}`).expect(200);
      const next = refreshValue(cookieOf(rotated));
      expect(next).not.toBe(used);
      const newAccess = rotated.body.accessToken;
      await t.api('get', '/users/me').set('authorization', bearer(newAccess)).expect(200);

      // Rejeu de l'ancien token (vol probable) : refusé, et la famille entière est révoquée.
      await t.api('post', '/auth/refresh').set('cookie', `refresh_token=${used}`).expect(401);
      await t.api('post', '/auth/refresh').set('cookie', `refresh_token=${next}`).expect(401);
      await t.api('get', '/users/me').set('authorization', bearer(newAccess)).expect(401);
      expect(t.prisma.auditLogs.some((l) => l.action === 'REFRESH_TOKEN_REUSE_DETECTED')).toBe(true);
    });

    it('déconnexion : révoque la session, le jeton d’accès cesse de fonctionner', async () => {
      const login = await t.api('post', '/auth/login').send({ identifier: 'student1@example.test', password: PASSWORD }).expect(200);
      const cookie = refreshValue(cookieOf(login));
      await t.api('post', '/auth/logout').set('x-requested-with', '').set('cookie', `refresh_token=${cookie}`).expect(403);
      const out = await t.api('post', '/auth/logout').set('cookie', `refresh_token=${cookie}`).expect(204);
      expect(cookieOf(out)).toMatch(/refresh_token=;/);
      await t.api('get', '/users/me').set('authorization', bearer(login.body.accessToken)).expect(401);
      await t.api('post', '/auth/refresh').set('cookie', `refresh_token=${cookie}`).expect(401);
    });

    it('refresh sans cookie ou avec un token inconnu : 401', async () => {
      await t.api('post', '/auth/refresh').expect(401);
      await t.api('post', '/auth/refresh').set('cookie', 'refresh_token=inconnu').expect(401);
    });

    it('un compte suspendu ne peut plus se connecter ni rafraîchir', async () => {
      const u = await t.world.addUser('suspended@example.test', [{ role: Role.STUDENT, institutionId: t.world.instA.id }]);
      const login = await t.api('post', '/auth/login').send({ identifier: 'suspended@example.test', password: PASSWORD }).expect(200);
      const cookie = refreshValue(cookieOf(login));
      t.prisma.users.find((x) => x.id === u.id)!.status = 'SUSPENDED';
      await t.api('post', '/auth/refresh').set('cookie', `refresh_token=${cookie}`).expect(401);
      await t.api('post', '/auth/login').send({ identifier: 'suspended@example.test', password: PASSWORD }).expect(401);
    });
  });

  describe('administrateur sans 2FA — jeton de configuration (D-15)', () => {
    let setupToken: string;
    let secret: string;
    const email = 'new-admin@example.test';

    beforeAll(async () => {
      await t.world.addUser(email, [{ role: Role.INSTITUTION_ADMIN, institutionId: t.world.instA.id }], { twoFactorEnabled: false });
    });

    it('la connexion renvoie un jeton de configuration, ni jeton d’accès ni cookie', async () => {
      const res = await t.api('post', '/auth/login').send({ identifier: email, password: PASSWORD }).expect(200);
      expect(res.body.status).toBe('two_factor_setup_required');
      expect(res.body.accessToken).toBeUndefined();
      expect(cookieOf(res)).toBe('');
      setupToken = res.body.setupToken;
      expect(t.prisma.users.find((u) => u.email === email)!.setupTokenJti).toBeTruthy();
      expect(t.prisma.auditLogs.some((l) => l.action === 'TWO_FACTOR_SETUP_TOKEN_ISSUED')).toBe(true);
    });

    it('le jeton de configuration ne sert à RIEN d’autre que configurer la 2FA', async () => {
      await t.api('get', '/users/me').set('authorization', bearer(setupToken)).expect(401);
      await t.api('get', `/institutions/${t.world.instA.id}/staff`).set('authorization', bearer(setupToken)).expect(401);
      await t.api('post', '/auth/step-up').set('authorization', bearer(setupToken)).send({ code: '123456' }).expect(401);
      await t.api('patch', '/users/me/password').set('authorization', bearer(setupToken)).send({}).expect(401);
    });

    it('une session « normale » d’un admin sans 2FA (cas anormal) n’ouvre rien : D-10, la 2FA reste obligatoire', async () => {
      const u = t.prisma.users.find((x) => x.email === email)!;
      const { token } = await t.world.session(u.id);
      await t.api('get', '/users/me').set('authorization', bearer(token)).expect(403);
      await t.api('post', '/auth/2fa/setup').set('authorization', bearer(token)).expect(403);
    });

    it('setup : le secret est chiffré en base (AES-256-GCM) et jamais stocké en clair', async () => {
      const res = await t.api('post', '/auth/2fa/setup').set('authorization', bearer(setupToken)).expect(200);
      secret = res.body.secret;
      expect(res.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
      const stored = t.prisma.users.find((u) => u.email === email)!.twoFactorSecretEnc as string;
      expect(stored).toMatch(/^v1\./);
      expect(stored).not.toContain(secret);
      expect(new SecretCipher(process.env.TWO_FACTOR_ENCRYPTION_KEY!).decrypt(stored)).toBe(secret);
    });

    it('un mauvais code n’active rien et ne consomme pas le jeton', async () => {
      await t.api('post', '/auth/2fa/enable').set('authorization', bearer(setupToken)).send({ code: '000000' }).expect(400);
      expect(t.prisma.users.find((u) => u.email === email)!.twoFactorEnabled).toBe(false);
    });

    it('le bon code active la 2FA, ouvre la session et CONSOMME le jeton (usage unique)', async () => {
      const res = await t.api('post', '/auth/2fa/enable').set('authorization', bearer(setupToken)).send({ code: authenticator.generate(secret) }).expect(200);
      expect(res.body.status).toBe('authenticated');
      expect(res.body.accessToken).toBeTruthy();
      expect(cookieOf(res)).toMatch(/HttpOnly/i);
      const user = t.prisma.users.find((u) => u.email === email)!;
      expect(user.twoFactorEnabled).toBe(true);
      expect(user.setupTokenJti).toBeNull();
      // La session issue d'une 2FA vient d'être vérifiée : action sensible possible sans step-up.
      expect(t.prisma.refreshTokens.find((r) => r.userId === user.id && !r.revokedAt)!.twoFactorVerifiedAt).toBeInstanceOf(Date);
      for (const action of ['TWO_FACTOR_SETUP_TOKEN_USED']) expect(t.prisma.auditLogs.some((l) => l.action === action)).toBe(true);
      // Rejeu du même jeton : refusé.
      await t.api('post', '/auth/2fa/setup').set('authorization', bearer(setupToken)).expect(401);
      await t.api('post', '/auth/2fa/enable').set('authorization', bearer(setupToken)).send({ code: authenticator.generate(secret) }).expect(401);
    });

    it('un nouveau jeton invalide le précédent, et un jeton expiré est refusé', async () => {
      const u = await t.world.addUser('second-admin@example.test', [{ role: Role.VERIFICATION_OFFICER, institutionId: t.world.instA.id }], { twoFactorEnabled: false });
      const a = await t.api('post', '/auth/login').send({ identifier: 'second-admin@example.test', password: PASSWORD });
      const b = await t.api('post', '/auth/login').send({ identifier: 'second-admin@example.test', password: PASSWORD });
      await t.api('post', '/auth/2fa/setup').set('authorization', bearer(a.body.setupToken)).expect(401);
      await t.api('post', '/auth/2fa/setup').set('authorization', bearer(b.body.setupToken)).expect(200);
      // Expiration : jeton signé avec une durée négative.
      const { JwtService } = await import('@nestjs/jwt');
      const expired = t.app.get(JwtService).sign(
        { sub: u.id, jti: t.prisma.users.find((x) => x.id === u.id)!.setupTokenJti, typ: 'setup' },
        { secret: process.env.JWT_REFRESH_SECRET, expiresIn: -10 },
      );
      await t.api('post', '/auth/2fa/setup').set('authorization', bearer(expired)).expect(401);
    });

    it('connexion suivante : code TOTP exigé, mauvais code refusé avec le message générique', async () => {
      const need = await t.api('post', '/auth/login').send({ identifier: email, password: PASSWORD }).expect(200);
      expect(need.body).toEqual({ status: 'two_factor_required' });
      const bad = await t.api('post', '/auth/login').send({ identifier: email, password: PASSWORD, totp: '000000' });
      expect(bad.status).toBe(401);
      expect(bad.body.message).toBe('invalid_credentials');
      const ok = await t.api('post', '/auth/login').send({ identifier: email, password: PASSWORD, totp: authenticator.generate(secret) }).expect(200);
      expect(ok.body.status).toBe('authenticated');
      // Mot de passe faux : jamais d'indication sur la 2FA.
      const wrongPw = await t.api('post', '/auth/login').send({ identifier: email, password: 'mauvais-mot-de-passe' });
      expect(wrongPw.body.message).toBe('invalid_credentials');
    });

    it('step-up : un code valide rend les actions sensibles possibles pendant 10 minutes', async () => {
      const u = t.prisma.users.find((x) => x.email === email)!;
      const s = await t.world.session(u.id, { mfaAgeMs: null });
      await t.api('post', '/auth/step-up').set('authorization', bearer(s.token)).send({ code: '000000' }).expect(400);
      await t.api('post', '/auth/step-up').set('authorization', bearer(s.token)).send({ code: authenticator.generate(secret) }).expect(204);
      const row = t.prisma.refreshTokens.find((r) => r.familyId === s.familyId)!;
      expect(Date.now() - row.twoFactorVerifiedAt.getTime()).toBeLessThan(5_000);
    });
  });

  describe('2FA optionnelle pour un étudiant (D-10)', () => {
    it('un étudiant se connecte sans 2FA, puis peut l’activer avec son jeton d’accès', async () => {
      const email = 'student-2fa@example.test';
      await t.world.addUser(email, [{ role: Role.STUDENT, institutionId: t.world.instA.id }]);
      const login = await t.api('post', '/auth/login').send({ identifier: email, password: PASSWORD }).expect(200);
      expect(login.body.status).toBe('authenticated');
      const token = login.body.accessToken;
      const setup = await t.api('post', '/auth/2fa/setup').set('authorization', bearer(token)).expect(200);
      const enable = await t.api('post', '/auth/2fa/enable').set('authorization', bearer(token)).send({ code: authenticator.generate(setup.body.secret) }).expect(200);
      expect(enable.body).toEqual({ status: 'enabled' });
      await t.api('post', '/auth/2fa/setup').set('authorization', bearer(token)).expect(409);
    });
  });

  describe('mot de passe', () => {
    it('le changement exige l’ancien, impose 10 caractères et ferme les AUTRES sessions', async () => {
      const email = 'pw@example.test';
      const u = await t.world.addUser(email, [{ role: Role.STUDENT, institutionId: t.world.instA.id }]);
      const current = await t.world.session(u.id);
      const other = await t.world.session(u.id);
      const auth = bearer(current.token);
      await t.api('patch', '/users/me/password').set('authorization', auth).send({ currentPassword: 'faux-faux-faux', newPassword: 'nouveau-mot-de-passe' }).expect(401);
      await t.api('patch', '/users/me/password').set('authorization', auth).send({ currentPassword: PASSWORD, newPassword: 'court' }).expect(400);
      await t.api('patch', '/users/me/password').set('authorization', auth).send({ currentPassword: PASSWORD, newPassword: 'nouveau-mot-de-passe' }).expect(204);
      await t.api('get', '/users/me').set('authorization', auth).expect(200);
      await t.api('get', '/users/me').set('authorization', bearer(other.token)).expect(401);
      await t.api('post', '/auth/login').send({ identifier: email, password: PASSWORD }).expect(401);
      await t.api('post', '/auth/login').send({ identifier: email, password: 'nouveau-mot-de-passe' }).expect(200);
    });
  });

  describe('verrou par compte', () => {
    it('5 échecs verrouillent le compte, même avec le bon mot de passe ensuite', async () => {
      const email = 'lock@example.test';
      await t.world.addUser(email, [{ role: Role.STUDENT, institutionId: t.world.instA.id }]);
      for (let i = 0; i < 5; i++) await t.api('post', '/auth/login').send({ identifier: email, password: 'mauvais-mot-de-passe' }).expect(401);
      await t.api('post', '/auth/login').send({ identifier: email, password: PASSWORD }).expect(401);
    });
  });

  describe('audit des événements d’authentification', () => {
    it('aucun mot de passe, jeton, code 2FA ni secret dans audit_logs', () => {
      const dump = JSON.stringify(t.prisma.auditLogs.map((l) => ({ ...l, id: String(l.id) })));
      expect(dump).not.toContain(PASSWORD);
      expect(dump).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./); // pas de JWT
      expect(dump).not.toMatch(/refresh_token/);
      expect(dump).not.toMatch(/otpauth:/);
    });

    it('l’IP n’est stockée que sous forme de hash salé', () => {
      const withIp = t.prisma.auditLogs.filter((l) => l.ipHash);
      expect(withIp.length).toBeGreaterThan(0);
      for (const l of withIp) expect(l.ipHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(t.prisma.auditLogs.map((l) => ({ ...l, id: String(l.id) })))).not.toMatch(/\b10\.\d+\.\d+\.1\b/);
    });
  });
});
