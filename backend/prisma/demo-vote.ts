// npm run demo:open-vote | demo:close-vote | demo:results [-- second] — démonstration du vote, refusée en production (voir src/seed/demo-vote.ts).
import 'reflect-metadata';
import { resolve } from 'path';

try {
  process.loadEnvFile(resolve(__dirname, '../../.env'));
} catch {
  /* pas de .env : seules les variables d'environnement comptent */
}
process.env.SCHEDULER_ENABLED = 'false'; // cette commande fait elle-même les transitions
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ElectionsService } from '../src/elections/elections.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDemoVoteAllowed, demoCloseVote, demoOpenVote, demoResults } from '../src/seed/demo-vote';
import { VotingLifecycleService } from '../src/voting/voting-lifecycle.service';

async function main() {
  assertDemoVoteAllowed(process.env); // échoue avant de démarrer l'application
  const command = process.argv[2];
  const target = process.argv[3] === 'second' ? 'second' : 'first'; // « npm run demo:open-vote -- second » vise le second tour
  if (!['open', 'close', 'results'].includes(command)) throw new Error('Usage : demo-vote.ts open | close | results [second]');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const deps = { prisma: app.get(PrismaService), lifecycle: app.get(VotingLifecycleService), elections: app.get(ElectionsService), target } as const;
    const lines = command === 'open' ? await demoOpenVote(deps) : command === 'close' ? await demoCloseVote(deps) : await demoResults(deps);
    console.log(`\n${lines.join('\n')}\n`);
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(`\n${e instanceof Error ? e.message : e}\n`);
  process.exit(1);
});
