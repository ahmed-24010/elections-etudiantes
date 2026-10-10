import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditResult, Prisma, Role } from '@prisma/client';
import { createHash, createHmac } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  actorId?: string | null;
  actorRole?: Role | null;
  institutionId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  result: AuditResult;
  ip?: string | null;
  requestId?: string | null;
  /** Jamais de choix de vote, de mot de passe, de jeton ni de code 2FA ici (02 §9). */
  metadata?: Record<string, unknown> | null;
}

/** prevHash de la première ligne (jamais NULL, pour que l'unicité de prevHash couvre aussi la première place). */
export const GENESIS_HASH = '0'.repeat(64);
const MAX_CHAIN_ATTEMPTS = 100;

/** JSON canonique : clés triées récursivement, car MySQL réordonne les clés des colonnes JSON. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export interface HashedContent {
  actorId: string | null;
  actorRole: string | null;
  institutionId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  result: string;
  ipHash: string | null;
  requestId: string | null;
  metadata: unknown;
  createdAt: string;
}

/** hash = SHA-256(prevHash + contenu), 02 §9. */
export function computeAuditHash(prevHash: string, content: HashedContent): string {
  return createHash('sha256').update(`${prevHash}|${canonicalJson(content)}`).digest('hex');
}

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  hashIp(ip: string | null | undefined): string | null {
    if (!ip) return null;
    return createHmac('sha256', this.config.getOrThrow<string>('AUDIT_IP_SALT')).update(ip).digest('hex');
  }

  /**
   * Ajoute une ligne à la chaîne. L'unicité de `prevHash` (index unique) empêche deux écritures concurrentes de
   * prendre la même place : la perdante reçoit P2002, relit le dernier hash et réessaie. Aucun verrou ni droit UPDATE
   * n'est nécessaire (app_runtime n'a que INSERT et SELECT sur cette table).
   */
  async record(entry: AuditEntry): Promise<void> {
    const createdAt = new Date();
    const content: HashedContent = {
      actorId: entry.actorId ?? null,
      actorRole: entry.actorRole ?? null,
      institutionId: entry.institutionId ?? null,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      result: entry.result,
      ipHash: this.hashIp(entry.ip),
      requestId: entry.requestId ?? null,
      metadata: entry.metadata ?? null,
      createdAt: createdAt.toISOString(),
    };
    for (let attempt = 1; ; attempt++) {
      const last = await this.prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { hash: true } });
      const prevHash = last?.hash ?? GENESIS_HASH;
      try {
        await this.prisma.auditLog.create({
          data: {
            ...content,
            actorRole: content.actorRole as Role | null,
            metadata: (content.metadata ?? Prisma.DbNull) as Prisma.InputJsonValue,
            result: entry.result,
            createdAt,
            prevHash,
            hash: computeAuditHash(prevHash, content),
          },
        });
        return;
      } catch (e) {
        const collision = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
        if (!collision || attempt >= MAX_CHAIN_ATTEMPTS) throw e;
        // Petit délai aléatoire croissant pour désynchroniser les écrivains en conflit.
        await new Promise((resolve) => setTimeout(resolve, Math.random() * Math.min(attempt, 10) * 2));
      }
    }
  }

  /** Recalcule toute la chaîne ; renvoie l'id de la première ligne incohérente. */
  async verifyChain(batchSize = 500): Promise<{ valid: boolean; checked: number; brokenAtId?: string }> {
    let prevHash: string = GENESIS_HASH;
    let checked = 0;
    let cursor: bigint | undefined;
    for (;;) {
      const rows = await this.prisma.auditLog.findMany({
        orderBy: { id: 'asc' },
        take: batchSize,
        ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (rows.length === 0) return { valid: true, checked };
      for (const row of rows) {
        const expected = computeAuditHash(prevHash, {
          actorId: row.actorId,
          actorRole: row.actorRole,
          institutionId: row.institutionId,
          action: row.action,
          resourceType: row.resourceType,
          resourceId: row.resourceId,
          result: row.result,
          ipHash: row.ipHash,
          requestId: row.requestId,
          metadata: row.metadata ?? null,
          createdAt: row.createdAt.toISOString(),
        });
        if (row.prevHash !== prevHash || row.hash !== expected) {
          return { valid: false, checked, brokenAtId: row.id.toString() };
        }
        prevHash = row.hash;
        checked++;
      }
      cursor = rows[rows.length - 1].id;
    }
  }
}
