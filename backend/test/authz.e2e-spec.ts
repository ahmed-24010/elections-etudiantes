import { Controller, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { RequirePermission, ScopeFrom } from '../src/common/authz/decorators';
import { bearer, createTestApp, TestContext } from './helpers';

// Route de test : même décorateurs que 03 §7.2, pour exercer les vrais guards sur une ressource « élection ».
@Controller('t')
class ElectionProbeController {
  @Post('elections/:id/open')
  @RequirePermission('election:voting:open')
  @ScopeFrom('election', 'id')
  open() {
    return { opened: true };
  }
}

// Tests d'autorisation obligatoires de 03 §8 applicables au Sprint 2. Les n° 4, 5, 6 et 9 attendent les modules concernés.
describe('Autorisations (03 §8)', () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestApp({ controllers: [ElectionProbeController] });
  });
  afterAll(() => t.app.close());

  describe('n°1 — 401 sans token', () => {
    const routes: Array<['get' | 'post' | 'patch', string]> = [
      ['get', '/users/me'],
      ['patch', '/users/me/password'],
      ['post', '/users/some-id/suspend'],
      ['get', '/institutions/some-id/staff'],
      ['post', '/institutions/some-id/roles'],
      ['post', '/institutions/some-id/roles/some-id/revoke'],
      ['get', '/audit/verify-chain'],
      ['post', '/auth/step-up'],
      ['post', '/auth/2fa/setup'],
      ['post', '/auth/2fa/enable'],
      ['post', '/t/elections/some-id/open'],
    ];
    it.each(routes)('%s %s', async (method, path) => {
      await t.api(method, path).expect(401);
    });

    it('un jeton invalide ou falsifié est refusé', async () => {
      await t.api('get', '/users/me').set('authorization', bearer('pas.un.jwt')).expect(401);
    });
  });

  describe('n°2 — un INSTITUTION_ADMIN de A reçoit 404 sur toute ressource de B', () => {
    it('liste du personnel, attribution et révocation de rôle', async () => {
      const { world } = t;
      const iaA = await world.addUser('ia-a@example.test', [{ role: Role.INSTITUTION_ADMIN, institutionId: world.instA.id }]);
      const { token } = await world.session(iaA.id);
      await t.api('get', `/institutions/${world.instB.id}/staff`).set('authorization', bearer(token)).expect(404);
      await t.api('post', `/institutions/${world.instB.id}/roles`).set('authorization', bearer(token))
        .send({ email: 'x@example.test', role: 'VERIFICATION_OFFICER' }).expect(404);
      await t.api('post', `/institutions/${world.instB.id}/roles/abc/revoke`).set('authorization', bearer(token)).expect(404);
      // Même réponse qu'une ressource qui n'existe pas : l'existence de B n'est pas révélée.
      const unknown = await t.api('get', `/institutions/${crypto.randomUUID()}/staff`).set('authorization', bearer(token));
      expect(unknown.status).toBe(404);
      await t.api('get', `/institutions/${world.instA.id}/staff`).set('authorization', bearer(token)).expect(200);
    });

    it('une élection de B est invisible (404), une élection de A est accessible', async () => {
      const { world } = t;
      const iaA = await world.addUser('ia-a2@example.test', [{ role: Role.INSTITUTION_ADMIN, institutionId: world.instA.id }]);
      const { token } = await world.session(iaA.id);
      await t.api('post', `/t/elections/${world.elZ.id}/open`).set('authorization', bearer(token)).expect(404);
      await t.api('post', `/t/elections/${world.elX.id}/open`).set('authorization', bearer(token)).expect(201);
    });

    it("l'institution est lue en base : rien dans le corps ou la requête ne peut la changer", async () => {
      const { world } = t;
      const iaA = await world.addUser('ia-a3@example.test', [{ role: Role.INSTITUTION_ADMIN, institutionId: world.instA.id }]);
      const { token } = await world.session(iaA.id);
      await t.api('get', `/institutions/${world.instB.id}/staff?institutionId=${world.instA.id}`)
        .set('authorization', bearer(token)).set('x-institution-id', world.instA.id).expect(404);
    });
  });

  describe("n°3 — un membre du comité de l'élection X reçoit 403 sur l'élection Y", () => {
    it('X autorisé, Y interdit (même institution), élection de B invisible', async () => {
      const { world } = t;
      const ec = await world.addUser('ec-x@example.test', [
        { role: Role.STUDENT, institutionId: world.instA.id },
        { role: Role.ELECTION_COMMITTEE, institutionId: world.instA.id, electionId: world.elX.id },
      ]);
      const { token } = await world.session(ec.id);
      await t.api('post', `/t/elections/${world.elX.id}/open`).set('authorization', bearer(token)).expect(201);
      await t.api('post', `/t/elections/${world.elY.id}/open`).set('authorization', bearer(token)).expect(403);
      await t.api('post', `/t/elections/${world.elZ.id}/open`).set('authorization', bearer(token)).expect(404);
    });
  });

  describe('refus par défaut et séparation des rôles', () => {
    it("un étudiant n'a aucune permission d'administration", async () => {
      const { world } = t;
      const st = await world.addUser('student@example.test', [{ role: Role.STUDENT, institutionId: world.instA.id }]);
      const { token } = await world.session(st.id);
      await t.api('get', `/institutions/${world.instA.id}/staff`).set('authorization', bearer(token)).expect(403);
      await t.api('post', `/institutions/${world.instA.id}/roles`).set('authorization', bearer(token))
        .send({ email: 'x@example.test', role: 'VERIFICATION_OFFICER' }).expect(403);
      await t.api('get', '/audit/verify-chain').set('authorization', bearer(token)).expect(403);
      await t.api('get', '/users/me').set('authorization', bearer(token)).expect(200);
    });

    it('SUPER_ADMIN ne gère pas le contenu : il ne peut ouvrir le vote ni attribuer un rôle de vérificateur', async () => {
      const { world } = t;
      const sa = await world.addUser('sa@example.test', [{ role: Role.SUPER_ADMIN }], { twoFactorEnabled: true });
      const { token } = await world.session(sa.id);
      await t.api('post', `/t/elections/${world.elX.id}/open`).set('authorization', bearer(token)).expect(403);
      await t.api('post', `/institutions/${world.instA.id}/roles`).set('authorization', bearer(token))
        .send({ email: 'x@example.test', role: 'VERIFICATION_OFFICER' }).expect(403);
    });
  });

  describe('n°7 — une action sensible sans 2FA récente est refusée', () => {
    it('401 step_up_required si la 2FA a plus de 10 minutes ou n’a jamais eu lieu, 201 si elle est récente', async () => {
      const { world } = t;
      const ia = await world.addUser('ia-stepup@example.test', [{ role: Role.INSTITUTION_ADMIN, institutionId: world.instA.id }], { twoFactorEnabled: true });
      const fresh = await world.session(ia.id, { mfaAgeMs: 60_000 });
      const stale = await world.session(ia.id, { mfaAgeMs: 11 * 60_000 });
      const never = await world.session(ia.id, { mfaAgeMs: null });

      for (const s of [stale, never]) {
        const res = await t.api('post', `/t/elections/${world.elX.id}/open`).set('authorization', bearer(s.token));
        expect(res.status).toBe(401);
        expect(res.body.message).toBe('step_up_required');
      }
      await t.api('post', `/t/elections/${world.elX.id}/open`).set('authorization', bearer(fresh.token)).expect(201);
    });

    it("les refus et les succès d'une action sensible sont écrits dans audit_logs", async () => {
      const { world, prisma } = t;
      const ia = await world.addUser('ia-audit@example.test', [{ role: Role.INSTITUTION_ADMIN, institutionId: world.instA.id }]);
      const stale = await world.session(ia.id, { mfaAgeMs: null });
      const fresh = await world.session(ia.id, { mfaAgeMs: 0 });
      await t.api('post', `/t/elections/${world.elX.id}/open`).set('authorization', bearer(stale.token)).expect(401);
      await t.api('post', `/t/elections/${world.elX.id}/open`).set('authorization', bearer(fresh.token)).expect(201);
      const rows = prisma.auditLogs.filter((r) => r.actorId === ia.id && r.action === 'election:voting:open');
      expect(rows.map((r) => r.result).sort()).toEqual(['DENIED', 'SUCCESS']);
      expect(rows.every((r) => r.institutionId === world.instA.id && r.resourceId === world.elX.id)).toBe(true);
    });
  });

  describe('n°8 — une révocation de rôle prend effet à la requête suivante', () => {
    it("le même jeton d'accès perd ses droits dès que le rôle est révoqué", async () => {
      const { world, prisma } = t;
      const sa = await world.addUser('sa-revoke@example.test', [{ role: Role.SUPER_ADMIN }], { twoFactorEnabled: true });
      const saSession = await world.session(sa.id);
      const target = await world.addUser('vo-target@example.test', [{ role: Role.STUDENT, institutionId: world.instA.id }]);
      // Le futur admin a déjà activé sa 2FA (sans cela, D-10 ignore ses rôles administratifs).
      const admin = await world.addUser('ia-target@example.test', [{ role: Role.STUDENT, institutionId: world.instA.id }], { twoFactorEnabled: true });

      // SUPER_ADMIN attribue INSTITUTION_ADMIN, puis l'admin attribue VERIFICATION_OFFICER.
      const grantIa = await t.api('post', `/institutions/${world.instA.id}/roles`).set('authorization', bearer(saSession.token))
        .send({ email: 'ia-target@example.test', role: 'INSTITUTION_ADMIN' }).expect(201);
      const iaSession = await world.session(admin.id);
      await t.api('get', `/institutions/${world.instA.id}/staff`).set('authorization', bearer(iaSession.token)).expect(200);
      await t.api('post', `/institutions/${world.instA.id}/roles`).set('authorization', bearer(iaSession.token))
        .send({ email: 'vo-target@example.test', role: 'VERIFICATION_OFFICER' }).expect(201);

      // Révocation : la requête suivante, avec le MÊME jeton, est refusée.
      await t.api('post', `/institutions/${world.instA.id}/roles/${grantIa.body.assignmentId}/revoke`)
        .set('authorization', bearer(saSession.token)).expect(204);
      await t.api('get', `/institutions/${world.instA.id}/staff`).set('authorization', bearer(iaSession.token)).expect(403);
      expect(prisma.auditLogs.some((r) => r.action === 'ROLE_REVOKED' && r.metadata.targetUserId === admin.id)).toBe(true);
      expect(target.id).toBeDefined();
    });

    it('une suspension ferme la session immédiatement (401)', async () => {
      const { world } = t;
      const sa = await world.addUser('sa-susp@example.test', [{ role: Role.SUPER_ADMIN }], { twoFactorEnabled: true });
      const saSession = await world.session(sa.id);
      const ia = await world.addUser('ia-susp@example.test', [{ role: Role.INSTITUTION_ADMIN, institutionId: world.instA.id }]);
      const iaSession = await world.session(ia.id);
      await t.api('get', '/users/me').set('authorization', bearer(iaSession.token)).expect(200);
      await t.api('post', `/users/${ia.id}/suspend`).set('authorization', bearer(saSession.token)).expect(204);
      await t.api('get', '/users/me').set('authorization', bearer(iaSession.token)).expect(401);
    });
  });

  describe('D-10 — 2FA obligatoire pour les rôles administratifs', () => {
    it('un rôle admin attribué à une session existante sans 2FA ne donne AUCUN droit tant que la 2FA n’est pas active', async () => {
      const { world, prisma } = t;
      const u = await world.addUser('promoted@example.test', [{ role: Role.STUDENT, institutionId: world.instA.id }]);
      const { token } = await world.session(u.id);
      await t.api('get', `/institutions/${world.instA.id}/staff`).set('authorization', bearer(token)).expect(403);
      await prisma.roleAssignment.create({ data: { userId: u.id, role: Role.INSTITUTION_ADMIN, institutionId: world.instA.id } });
      await t.api('get', `/institutions/${world.instA.id}/staff`).set('authorization', bearer(token)).expect(403);
      await t.api('get', '/users/me').set('authorization', bearer(token)).expect(200); // son compte reste utilisable
      prisma.users.find((x) => x.id === u.id)!.twoFactorEnabled = true;
      await t.api('get', `/institutions/${world.instA.id}/staff`).set('authorization', bearer(token)).expect(200);
    });
  });

  describe('règles de conflit (03 §5.2, §6)', () => {
    it("personne ne s'attribue un rôle à soi-même", async () => {
      const { world } = t;
      const sa = await world.addUser('sa-self@example.test', [{ role: Role.SUPER_ADMIN }], { twoFactorEnabled: true });
      const { token } = await world.session(sa.id);
      const res = await t.api('post', `/institutions/${world.instA.id}/roles`).set('authorization', bearer(token))
        .send({ email: 'sa-self@example.test', role: 'INSTITUTION_ADMIN' });
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('cannot_assign_role_to_self');
    });

    it('personne ne se suspend soi-même ; un autre SUPER_ADMIN peut être suspendu', async () => {
      const { world } = t;
      const first = await world.addUser('sa-first@example.test', [{ role: Role.SUPER_ADMIN }], { twoFactorEnabled: true });
      const { token } = await world.session(first.id);
      const self = await t.api('post', `/users/${first.id}/suspend`).set('authorization', bearer(token));
      expect(self.status).toBe(409);
      expect(self.body.message).toBe('cannot_suspend_self');
      const second = await world.addUser('sa-second@example.test', [{ role: Role.SUPER_ADMIN }], { twoFactorEnabled: true });
      await t.api('post', `/users/${second.id}/suspend`).set('authorization', bearer(token)).expect(204);
    });

    it("un INSTITUTION_ADMIN ne peut pas suspendre un compte rattaché à une autre institution ni un SUPER_ADMIN", async () => {
      const { world } = t;
      const ia = await world.addUser('ia-susp2@example.test', [{ role: Role.INSTITUTION_ADMIN, institutionId: world.instA.id }], { twoFactorEnabled: true });
      const { token } = await world.session(ia.id);
      const inB = await world.addUser('student-b@example.test', [{ role: Role.STUDENT, institutionId: world.instB.id }]);
      await t.api('post', `/users/${inB.id}/suspend`).set('authorization', bearer(token)).expect(404);
      const sa = await world.addUser('sa-hidden@example.test', [{ role: Role.SUPER_ADMIN }, { role: Role.STUDENT, institutionId: world.instA.id }]);
      await t.api('post', `/users/${sa.id}/suspend`).set('authorization', bearer(token)).expect(403);
    });
  });

  // Dépendent de modules des sprints suivants (élections, vérification, candidatures, vote).
  it.todo('n°4 — un étudiant ne voit pas une élection pour laquelle il n’est pas éligible (Sprint 4)');
  it.todo('n°5 — un vérificateur ne peut pas valider sa propre inscription (Sprint 3)');
  it.todo('n°6 — un membre du comité ne peut pas candidater dans son élection (Sprint 5)');
  it.todo('n°9 — aucune réponse de /voting ou /results ne renvoie studentId avec un choix de vote (Sprints 6-7)');
});
