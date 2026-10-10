import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

type Row = Record<string, any>;

const p2002 = (name: string) =>
  new Prisma.PrismaClientKnownRequestError(`Unique constraint failed on ${name}`, { code: 'P2002', clientVersion: 'test' });

export interface TableOptions {
  name: string;
  defaults?: () => Row;
  /** Jeux de colonnes uniques. Comme MySQL, une valeur NULL ne provoque jamais de conflit. */
  unique?: string[][];
  /** Relations : nom → fonction qui renvoie la ou les lignes liées. */
  relations?: Record<string, (row: Row) => Row | Row[] | null | undefined>;
}

/** Table en mémoire générique pour la fausse base : where, include, select, orderBy, contraintes d'unicité. */
export class Table {
  rows: Row[] = [];
  constructor(private readonly opts: TableOptions) {}

  private rel(row: Row, name: string): Row[] {
    const r = this.opts.relations?.[name]?.(row);
    return r == null ? [] : Array.isArray(r) ? r : [r];
  }

  private match(row: Row, where?: Row): boolean {
    if (!where) return true;
    return Object.entries(where).every(([key, cond]) => {
      if (key === 'AND') return ([] as Row[]).concat(cond).every((c) => this.match(row, c));
      if (key === 'OR') return (cond as Row[]).some((c) => this.match(row, c));
      if (this.opts.relations?.[key]) {
        const related = this.rel(row, key);
        if (cond && 'some' in cond) return related.some((r) => this.matchLoose(r, cond.some));
        if (cond && 'is' in cond) return related.some((r) => this.matchLoose(r, cond.is));
        return related.some((r) => this.matchLoose(r, cond));
      }
      return this.matchValue(row[key], cond);
    });
  }

  /** Condition sur une ligne liée (table inconnue) : égalités simples et opérateurs courants. */
  private matchLoose(row: Row, where: Row): boolean {
    return Object.entries(where ?? {}).every(([k, c]) => this.matchValue(row[k], c));
  }

  private matchValue(value: any, cond: any): boolean {
    if (cond === null) return value === null || value === undefined;
    if (cond instanceof Date) return value instanceof Date && value.getTime() === cond.getTime();
    if (cond && typeof cond === 'object') {
      if ('not' in cond && (value === cond.not || (cond.not === null && (value ?? null) === null))) return false;
      if ('gt' in cond && !(value > cond.gt)) return false;
      if ('gte' in cond && !(value >= cond.gte)) return false;
      if ('lt' in cond && !(value < cond.lt)) return false;
      if ('lte' in cond && !(value <= cond.lte)) return false;
      if ('in' in cond && !cond.in.includes(value)) return false;
      if ('contains' in cond && !String(value ?? '').includes(cond.contains)) return false;
      return true;
    }
    return value === cond;
  }

  private shape(row: Row | undefined, args: Row = {}): Row | null {
    if (!row) return null;
    if (args.select) {
      const out: Row = {};
      for (const [k, v] of Object.entries<any>(args.select)) {
        if (!v) continue;
        if (this.opts.relations?.[k]) out[k] = this.relShape(row, k, v === true ? {} : v);
        else out[k] = row[k];
      }
      return out;
    }
    const out: Row = { ...row };
    for (const [k, v] of Object.entries<any>(args.include ?? {})) if (v) out[k] = this.relShape(row, k, v === true ? {} : v);
    return out;
  }

  /** Les lignes liées sont renvoyées brutes (filtrées par `where`), avec include/select appliqués par la table liée si possible. */
  private relShape(row: Row, name: string, spec: Row): Row | Row[] | null {
    const raw = this.opts.relations?.[name]?.(row);
    if (raw == null) return null;
    const apply = (r: Row) => ((spec.select || spec.include) && (r as any).__table ? (r as any).__table.shapeRow(r, spec) : { ...r });
    if (Array.isArray(raw)) {
      let list = raw.filter((r) => this.matchLoose(r, spec.where ?? {}));
      if (spec.orderBy) list = this.sort(list, spec.orderBy);
      return list.map(apply);
    }
    return apply(raw);
  }

  shapeRow(row: Row, args: Row): Row | null {
    return this.shape(row, args);
  }

  private sort(rows: Row[], orderBy: any): Row[] {
    const [[key, dir]] = Object.entries(Array.isArray(orderBy) ? orderBy[0] : orderBy) as [string, 'asc' | 'desc'][];
    return [...rows].sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
  }

  private checkUnique(row: Row, ignore?: Row) {
    for (const cols of this.opts.unique ?? []) {
      if (cols.some((c) => row[c] === null || row[c] === undefined)) continue;
      const clash = this.rows.find((r) => r !== ignore && cols.every((c) => r[c] === row[c]));
      if (clash) throw p2002(`${this.opts.name}.${cols.join('_')}`);
    }
  }

  async findMany(a: Row = {}) {
    let rows = this.rows.filter((r) => this.match(r, a.where));
    if (a.orderBy) rows = this.sort(rows, a.orderBy);
    if (a.take) rows = rows.slice(0, a.take);
    return rows.map((r) => this.shape(r, a)!);
  }

  async findFirst(a: Row = {}) {
    return (await this.findMany({ ...a, take: 1 }))[0] ?? null;
  }

  async findUnique(a: Row) {
    const where = a.where as Row;
    // clé composée Prisma : { institutionId_code: { institutionId, code } }
    const flat = Object.fromEntries(Object.entries(where).flatMap(([k, v]) => (v && typeof v === 'object' && !(v instanceof Date) ? Object.entries(v) : [[k, v]])));
    return this.shape(this.rows.find((r) => Object.entries(flat).every(([k, v]) => r[k] === v)), a);
  }

  async findUniqueOrThrow(a: Row) {
    const r = await this.findUnique(a);
    if (!r) throw new Prisma.PrismaClientKnownRequestError('Not found', { code: 'P2025', clientVersion: 'test' });
    return r;
  }

  async create(a: Row) {
    const row: Row = { id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), ...this.opts.defaults?.(), ...a.data };
    for (const [k, v] of Object.entries(row)) if (v === undefined) delete row[k];
    this.checkUnique(row);
    Object.defineProperty(row, '__table', { value: this, enumerable: false });
    this.rows.push(row);
    return this.shape(row, a)!;
  }

  async update(a: Row) {
    const row = this.rows.find((r) => Object.entries(a.where).every(([k, v]) => r[k] === v));
    if (!row) throw new Prisma.PrismaClientKnownRequestError('Not found', { code: 'P2025', clientVersion: 'test' });
    const next = { ...row, ...Object.fromEntries(Object.entries(a.data).filter(([, v]) => v !== undefined)), updatedAt: new Date() };
    this.checkUnique(next, row);
    Object.assign(row, next);
    return this.shape(row, a)!;
  }

  async updateMany(a: Row) {
    const rows = this.rows.filter((r) => this.match(r, a.where));
    rows.forEach((r) => Object.assign(r, a.data));
    return { count: rows.length };
  }

  async delete(a: Row) {
    const i = this.rows.findIndex((r) => Object.entries(a.where).every(([k, v]) => r[k] === v));
    if (i < 0) throw new Prisma.PrismaClientKnownRequestError('Not found', { code: 'P2025', clientVersion: 'test' });
    return this.rows.splice(i, 1)[0];
  }

  async count(a: Row = {}) {
    return this.rows.filter((r) => this.match(r, a.where)).length;
  }
}
