// npm run seed:demo — données de DÉMONSTRATION : SEED_DEMO_PASSWORD et SEED_DEMO_TOTP_SECRET requis, refusé en production (voir src/seed/seed-demo.ts).
import 'reflect-metadata';
import { resolve } from 'path';

try {
  process.loadEnvFile(resolve(__dirname, '../../.env'));
} catch {
  /* pas de .env : seules les variables d'environnement comptent */
}
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AuditService } from '../src/audit/audit.service';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDemoSeedAllowed, runDemoSeed } from '../src/seed/seed-demo';

async function main() {
  assertDemoSeedAllowed(process.env); // échoue avant de démarrer l'application
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const result = await runDemoSeed(
      {
        prisma: app.get(PrismaService),
        audit: app.get(AuditService),
        hashPassword: (p) => app.get(AuthService).hashPassword(p),
      },
      process.env,
    );
    console.log(`\nSeed de démonstration terminé. Élection de démo : ${result.electionStatus}.`);
    console.log('Mot de passe de tous les comptes : SEED_DEMO_PASSWORD (.env) ; code 2FA des comptes de gestion : clé SEED_DEMO_TOTP_SECRET.\n');
    console.table(result.accounts.map((a) => ({ e_mail: a.email, rôle: a.role, '2FA': a.twoFactor ? 'oui' : 'non' })));
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
