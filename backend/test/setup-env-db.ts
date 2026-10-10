// Tests contre une VRAIE base MySQL (npm run test:db). DATABASE_URL doit pointer vers le compte app_runtime d'une base
// déjà migrée (prisma migrate deploy) ; elle n'est jamais remplacée ici, contrairement à setup-env.ts.
if (!process.env.DATABASE_URL || /\/\/u:p@/.test(process.env.DATABASE_URL)) {
  throw new Error('test:db : DATABASE_URL (compte app_runtime d’une base migrée) est requis. Voir CLAUDE.md, section Commandes.');
}
process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
process.env.TWO_FACTOR_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.AUDIT_IP_SALT = 'test-salt-test-salt';
process.env.LOG_LEVEL = 'fatal';
process.env.NODE_ENV = 'test';
