// npm run seed — données de DÉVELOPPEMENT : SEED_ADMIN_PASSWORD requis, refusé en production (voir src/seed/seed.ts).
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AuditService } from '../src/audit/audit.service';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertSeedAllowed, runSeed } from '../src/seed/seed';

async function main() {
  assertSeedAllowed(process.env); // échoue avant de démarrer l'application
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const result = await runSeed(
      {
        prisma: app.get(PrismaService),
        audit: app.get(AuditService),
        hashPassword: (p) => app.get(AuthService).hashPassword(p),
      },
      process.env,
    );
    console.log('Seed terminé :', result);
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
