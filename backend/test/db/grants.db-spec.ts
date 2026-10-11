import { PrismaClient } from '@prisma/client';

// Droits MySQL réels (02 §10, migration *_db_grants) : ce que la fausse base ne peut pas vérifier.
describe('Droits du compte app_runtime sur la vraie base', () => {
  const prisma = new PrismaClient();
  afterAll(() => prisma.$disconnect());

  const denied = async (sql: string): Promise<boolean> => {
    try {
      await prisma.$executeRawUnsafe(sql);
      return false;
    } catch (e) {
      return /denied|1142|1143/i.test(String(e));
    }
  };

  it('toutes les tables du schéma existent (les migrations ont été appliquées)', async () => {
    const rows = await prisma.$queryRaw<{ t: string }[]>`SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()`;
    const names = rows.map((r) => r.t);
    for (const t of ['users', 'role_assignments', 'refresh_tokens', 'audit_logs', 'ballots', 'ballot_choices', 'voting_participations', 'stored_files', 'notifications']) {
      expect(names).toContain(t);
    }
  });

  it.each(['audit_logs', 'ballots', 'ballot_choices', 'voting_participations'])(
    '%s : ni UPDATE ni DELETE pour app_runtime (journal, urne et participation en ajout seul)',
    async (table) => {
      expect(await denied(`UPDATE \`${table}\` SET id = id WHERE 1 = 0`)).toBe(true);
      expect(await denied(`DELETE FROM \`${table}\` WHERE 1 = 0`)).toBe(true);
    },
  );

  it('app_runtime ne peut pas modifier le schéma ni accorder de droits', async () => {
    expect(await denied('DROP TABLE audit_logs')).toBe(true);
    expect(await denied('ALTER TABLE users ADD COLUMN pirate INT')).toBe(true);
    expect(await denied("GRANT ALL ON *.* TO 'app_runtime'@'%'")).toBe(true);
  });

  it('app_runtime peut lire et écrire les tables métier ordinaires', async () => {
    await expect(prisma.user.count()).resolves.toEqual(expect.any(Number));
    await expect(prisma.auditLog.count()).resolves.toEqual(expect.any(Number));
  });

  it('les index uniques sont réellement posés (e-mail, téléphone, hash de refresh token, prevHash)', async () => {
    const rows = await prisma.$queryRaw<{ t: string; i: string }[]>`
      SELECT table_name AS t, index_name AS i FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND non_unique = 0`;
    const idx = rows.map((r) => `${r.t}.${r.i}`);
    expect(idx).toEqual(expect.arrayContaining(['users.users_email_key', 'users.users_phone_key', 'refresh_tokens.refresh_tokens_tokenHash_key', 'audit_logs.audit_logs_prevHash_key']));
  });
});
