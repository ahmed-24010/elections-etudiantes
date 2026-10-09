import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

/**
 * Fausse base en mémoire : juste assez de PrismaClient pour les guards, services et contrôleurs du Sprint 2.
 * Elle reproduit les contraintes qui comptent pour la sécurité : unicité de users.email / users.phone,
 * de refresh_tokens.tokenHash et de audit_logs.prevHash (erreur P2002 comme MySQL).
 * Ne remplace pas un test sur la vraie base (voir docs : tests e2e « Prisma simulé »).
 */
type Row = Record<string, any>;

const p2002 = (field: string) =>
  new Prisma.PrismaClientKnownRequestError(`Unique constraint failed on ${field}`, { code: 'P2002', clientVersion: 'test' });

function matches(row: Row, where: Row | undefined, rel: (r: Row, name: string) => Row[]): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'roles' || key === 'user') {
      const related = rel(row, key);
      if (cond && 'some' in cond) return related.some((r) => matches(r, cond.some, rel));
      return related.some((r) => matches(r, cond, rel));
    }
    const value = row[key];
    if (cond === null) return value === null || value === undefined;
    if (cond instanceof Date) return value instanceof Date && value.getTime() === cond.getTime();
    if (cond && typeof cond === 'object') {
      if ('not' in cond && (value === cond.not || (cond.not === null && (value ?? null) === null))) return false;
      if ('gt' in cond && !(value > cond.gt)) return false;
      if ('in' in cond && !cond.in.includes(value)) return false;
      return true;
    }
    return value === cond;
  });
}

export class FakePrisma {
  users: Row[] = [];
  roleAssignments: Row[] = [];
  refreshTokens: Row[] = [];
  institutions: Row[] = [];
  elections: Row[] = [];
  auditLogs: Row[] = [];
  private auditSeq = 0n;

  private rel = (row: Row, name: string): Row[] => {
    if (name === 'roles') return this.roleAssignments.filter((r) => r.userId === row.id);
    if (name === 'user') return this.users.filter((u) => u.id === row.userId);
    return [];
  };

  private find(rows: Row[], where?: Row) {
    return rows.filter((r) => matches(r, where, this.rel));
  }

  /** Applique include / select de manière récursive. */
  private shape(row: Row | undefined, args: Row = {}): Row | null {
    if (!row) return null;
    if (args.select) {
      return Object.fromEntries(Object.keys(args.select).filter((k) => args.select[k]).map((k) => [k, row[k]]));
    }
    const out: Row = { ...row };
    for (const [name, spec] of Object.entries<any>(args.include ?? {})) {
      const related = this.find(this.rel(row, name), spec?.where).map((r) => this.shape(r, spec === true ? {} : spec));
      out[name] = name === 'user' ? related[0] ?? null : related;
    }
    return out;
  }

  private orThrow<T>(v: T | null | undefined): T {
    if (!v) throw new Prisma.PrismaClientKnownRequestError('Not found', { code: 'P2025', clientVersion: 'test' });
    return v;
  }

  user = {
    findUnique: async (a: Row) => this.shape(this.users.find((u) => Object.entries(a.where).every(([k, v]) => u[k] === v)), a),
    findUniqueOrThrow: async (a: Row) => this.orThrow(await this.user.findUnique(a)),
    create: async (a: Row) => {
      const { roles, ...data } = a.data;
      for (const f of ['email', 'phone']) {
        if (data[f] && this.users.some((u) => u[f] === data[f])) throw p2002(`users.${f}`);
      }
      const row: Row = {
        id: randomUUID(), email: null, phone: null, status: 'ACTIVE', twoFactorEnabled: false, twoFactorSecretEnc: null,
        setupTokenJti: null, lastLoginAt: null, createdAt: new Date(), ...data,
      };
      this.users.push(row);
      for (const r of [roles?.create].flat().filter(Boolean)) this.roleAssignment.create({ data: { ...r, userId: row.id } });
      return this.shape(row, a)!;
    },
    update: async (a: Row) => {
      const row = this.orThrow(this.users.find((u) => u.id === a.where.id));
      Object.assign(row, a.data);
      return this.shape(row, a)!;
    },
    count: async (a: Row = {}) => this.find(this.users, a.where).length,
  };

  roleAssignment = {
    findMany: async (a: Row = {}) => this.find(this.roleAssignments, a.where).map((r) => this.shape(r, a)!),
    findFirst: async (a: Row = {}) => this.shape(this.find(this.roleAssignments, a.where)[0], a),
    create: async (a: Row) => {
      const row: Row = { id: randomUUID(), institutionId: null, electionId: null, grantedById: null, createdAt: new Date(), revokedAt: null, ...a.data };
      this.roleAssignments.push(row);
      return row;
    },
    update: async (a: Row) => {
      const row = this.orThrow(this.roleAssignments.find((r) => r.id === a.where.id));
      Object.assign(row, a.data);
      return row;
    },
    count: async (a: Row = {}) => this.find(this.roleAssignments, a.where).length,
  };

  refreshToken = {
    findFirst: async (a: Row) => this.shape(this.find(this.refreshTokens, a.where)[0], a),
    findUnique: async (a: Row) => this.shape(this.refreshTokens.find((t) => Object.entries(a.where).every(([k, v]) => t[k] === v)), a),
    create: async (a: Row) => {
      if (this.refreshTokens.some((t) => t.tokenHash === a.data.tokenHash)) throw p2002('refresh_tokens.tokenHash');
      const row: Row = { revokedAt: null, replacedById: null, twoFactorVerifiedAt: null, createdAt: new Date(), ...a.data };
      this.refreshTokens.push(row);
      return row;
    },
    updateMany: async (a: Row) => {
      const where = { ...a.where };
      // « familyId: { not: x } » est géré par matches ; le reste est de l'égalité simple.
      const rows = this.find(this.refreshTokens, where);
      rows.forEach((r) => Object.assign(r, a.data));
      return { count: rows.length };
    },
  };

  institution = {
    findUnique: async (a: Row) => this.shape(this.institutions.find((i) => Object.entries(a.where).every(([k, v]) => i[k] === v)), a),
    findFirst: async (a: Row) => this.shape(this.find(this.institutions, a.where)[0], a),
    findMany: async (a: Row = {}) => this.find(this.institutions, a.where).map((r) => this.shape(r, a)!),
    create: async (a: Row) => {
      const row: Row = { id: randomUUID(), isActive: true, ...a.data };
      this.institutions.push(row);
      return row;
    },
  };

  election = {
    findUnique: async (a: Row) => this.shape(this.elections.find((e) => e.id === a.where.id), a),
  };

  auditLog = {
    findFirst: async (a: Row = {}) => {
      const rows = [...this.auditLogs].sort((x, y) => Number(y.id - x.id));
      return this.shape(rows[0], a);
    },
    findMany: async (a: Row = {}) => {
      let rows = [...this.auditLogs].sort((x, y) => Number(x.id - y.id));
      if (a.cursor) rows = rows.slice(rows.findIndex((r) => r.id === a.cursor.id) + (a.skip ?? 0));
      return rows.slice(0, a.take ?? rows.length).map((r) => ({ ...r }));
    },
    create: async (a: Row) => {
      if (a.data.prevHash && this.auditLogs.some((r) => r.prevHash === a.data.prevHash)) throw p2002('audit_logs.prevHash');
      const row: Row = {
        id: ++this.auditSeq, actorId: null, actorRole: null, institutionId: null, resourceId: null, ipHash: null, requestId: null,
        metadata: null, ...a.data,
      };
      if (row.metadata === Prisma.DbNull) row.metadata = null;
      this.auditLogs.push(row);
      return row;
    },
    count: async () => this.auditLogs.length,
  };

  $transaction = async (cb: (tx: FakePrisma) => Promise<unknown>) => cb(this);
  $queryRaw = async () => [{ 1: 1 }];
  $connect = async () => undefined;
  $disconnect = async () => undefined;
}
