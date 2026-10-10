import { Type } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { MemoryStorageService } from '../src/storage/memory-storage.service';
import { StorageService } from '../src/storage/storage.service';
import { FakePrisma } from './fake-prisma';

export const PASSWORD = 'Correct-horse-battery-1';
let passwordHash: Promise<string> | undefined;
export const hashedPassword = () => (passwordHash ??= argon2.hash(PASSWORD, { type: argon2.argon2id }));

export interface TestContext {
  app: NestExpressApplication;
  prisma: FakePrisma;
  /** Stockage S3 remplacé par une mémoire : on y inspecte ce qui a été (ou non) écrit. */
  storage: MemoryStorageService;
  world: World;
  /** Requête supertest depuis une IP distincte à chaque appel (derrière un proxy de confiance). */
  api: (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, ip?: string) => request.Test;
}

export async function createTestApp(opts: { trustProxy?: number; controllers?: Type<unknown>[] } = {}): Promise<TestContext> {
  const prisma = new FakePrisma();
  const mod = await Test.createTestingModule({ imports: [AppModule], controllers: opts.controllers ?? [] })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .overrideProvider(StorageService)
    .useClass(MemoryStorageService)
    .compile();
  const app = mod.createNestApplication<NestExpressApplication>();
  configureApp(app, { trustProxy: opts.trustProxy ?? 1 });
  await app.init();
  let n = 0;
  const api: TestContext['api'] = (method, path, ip) => {
    const agent = request(app.getHttpServer());
    return agent[method](`/api/v1${path}`)
      .set('x-forwarded-for', ip ?? `10.${Math.floor(++n / 250)}.${n % 250}.1`)
      .set('x-requested-with', 'XMLHttpRequest');
  };
  return { app, prisma, api, storage: app.get(StorageService) as MemoryStorageService, world: new World(app, prisma) };
}

export interface Grant {
  role: Role;
  institutionId?: string;
  electionId?: string;
}

/** Données de test : deux institutions, trois élections, et des comptes avec leurs rôles. */
export class World {
  instA = { id: randomUUID(), code: 'AAA', name: 'Institution A', isActive: true };
  instB = { id: randomUUID(), code: 'BBB', name: 'Institution B', isActive: true };
  elX = { id: randomUUID(), institutionId: this.instA.id };
  elY = { id: randomUUID(), institutionId: this.instA.id };
  elZ = { id: randomUUID(), institutionId: this.instB.id };

  constructor(
    private readonly app: NestExpressApplication,
    private readonly prisma: FakePrisma,
  ) {
    prisma.institutions.push(this.instA, this.instB);
    prisma.elections.push(this.elX, this.elY, this.elZ);
  }

  async addUser(email: string, grants: Grant[], extra: Record<string, unknown> = {}) {
    const user = await this.prisma.user.create({
      // D-10 : un compte administratif a sa 2FA active par défaut dans les fixtures ; les tests D-15 la désactivent.
      data: { email, passwordHash: await hashedPassword(), twoFactorEnabled: grants.some((g) => g.role !== Role.STUDENT), ...extra },
    });
    for (const g of grants) {
      await this.prisma.roleAssignment.create({ data: { userId: (user as any).id, ...g } });
    }
    return user as { id: string; email: string };
  }

  /** Ouvre une session (famille de refresh tokens) et renvoie un jeton d'accès valide. */
  async session(userId: string, opts: { mfaAgeMs?: number | null } = {}) {
    const familyId = randomUUID();
    const mfaAgeMs = opts.mfaAgeMs === undefined ? 0 : opts.mfaAgeMs;
    await this.prisma.refreshToken.create({
      data: {
        id: randomUUID(),
        userId,
        familyId,
        tokenHash: createHash('sha256').update(randomBytes(16)).digest('hex'),
        expiresAt: new Date(Date.now() + 86_400_000),
        twoFactorVerifiedAt: mfaAgeMs === null ? null : new Date(Date.now() - mfaAgeMs),
      },
    });
    const token = this.app.get(JwtService).sign(
      { sub: userId, sid: familyId, typ: 'access' },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '15m' },
    );
    return { token, familyId };
  }
}

export const bearer = (token: string) => `Bearer ${token}`;
