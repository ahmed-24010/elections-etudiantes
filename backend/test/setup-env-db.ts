// Tests contre une VRAIE base MySQL (npm run test:db). DATABASE_URL doit pointer vers le compte app_runtime d'une base
// déjà migrée (prisma migrate deploy) ; elle n'est jamais remplacée ici, contrairement à setup-env.ts.
if (!process.env.DATABASE_URL || /\/\/u:p@/.test(process.env.DATABASE_URL)) {
  throw new Error('test:db : DATABASE_URL (compte app_runtime d’une base migrée) est requis. Voir CLAUDE.md, section Commandes.');
}
// Ces tests créent des milliers de lignes : ils refusent de tourner ailleurs que sur une base dont le nom finit par « _test »
// (docker/mysql/init/02-test-db.sh), jamais sur la base de développement.
for (const name of ['DATABASE_URL', 'DATABASE_READONLY_URL']) {
  const url = process.env[name];
  if (url && !/\/[A-Za-z0-9_]+_test(\?.*)?$/.test(url)) {
    throw new Error(`test:db : ${name} doit viser une base dédiée dont le nom finit par _test (ex. elections_test), jamais la base de développement.`);
  }
}
process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
process.env.TWO_FACTOR_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.AUDIT_IP_SALT = 'test-salt-test-salt';
process.env.S3_ENDPOINT = 'http://s3.invalid:9000';
process.env.S3_REGION = 'us-east-1';
process.env.S3_BUCKET = 'test-bucket';
process.env.S3_ACCESS_KEY = 'test';
process.env.S3_SECRET_KEY = 'test';
process.env.FILE_SIGNING_SECRET = 'f'.repeat(32);
process.env.LOG_LEVEL = 'fatal';
process.env.NODE_ENV = 'test';
