import { Injectable } from '@nestjs/common';
import { EnrollmentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Critères d'une règle (02 §5) : un critère nul = « peu importe ». */
export interface RuleCriteria {
  facultyId?: string | null;
  programId?: string | null;
  levelId?: string | null;
  groupId?: string | null;
}

/** Ce que les règles regardent dans une inscription. */
export interface EnrollmentFacts {
  facultyId: string;
  programId: string;
  levelId: string;
  groupId: string | null;
}

const CRITERIA = ['facultyId', 'programId', 'levelId', 'groupId'] as const;

/** Vrai pour une règle sans aucun critère : « toute l'institution » (choix explicite, jamais un défaut). */
export const isWholeInstitution = (rule: RuleCriteria): boolean => CRITERIA.every((k) => !rule[k]);

/** Une règle = ET entre ses critères non nuls (02 §5). Un étudiant sans groupe ne satisfait jamais un critère de groupe. */
export function ruleMatches(rule: RuleCriteria, e: EnrollmentFacts): boolean {
  return CRITERIA.every((k) => !rule[k] || rule[k] === e[k]);
}

/** Plusieurs règles = OU. ZÉRO règle = personne n'est éligible (décision Sprint 4). */
export function rulesMatch(rules: RuleCriteria[], e: EnrollmentFacts): boolean {
  return rules.some((r) => ruleMatches(r, e));
}

/**
 * Condition Prisma équivalente à `rulesMatch`, bornée à l'institution, à l'année de l'élection et aux inscriptions
 * VERIFIED (02 §5). `null` = aucune règle = personne.
 */
export function eligibleWhere(election: { institutionId: string; academicYearId: string }, rules: RuleCriteria[]): Prisma.StudentEnrollmentWhereInput | null {
  if (rules.length === 0) return null;
  const base: Prisma.StudentEnrollmentWhereInput = {
    institutionId: election.institutionId,
    academicYearId: election.academicYearId,
    status: EnrollmentStatus.VERIFIED,
  };
  if (rules.some(isWholeInstitution)) return base; // une règle vide absorbe toutes les autres (OU)
  return {
    ...base,
    OR: rules.map((r) => Object.fromEntries(CRITERIA.filter((k) => r[k]).map((k) => [k, r[k]])) as Prisma.StudentEnrollmentWhereInput),
  };
}

@Injectable()
export class EligibilityService {
  constructor(private readonly prisma: PrismaService) {}

  private rules(electionId: string): Promise<RuleCriteria[]> {
    return this.prisma.eligibilityRule.findMany({ where: { electionId }, select: { facultyId: true, programId: true, levelId: true, groupId: true } });
  }

  /** Nombre d'électeurs éligibles : un chiffre, jamais une liste (D-02). Une inscription par étudiant et par année. */
  async countEligible(election: { id: string; institutionId: string; academicYearId: string }): Promise<number> {
    const where = eligibleWhere(election, await this.rules(election.id));
    return where ? this.prisma.studentEnrollment.count({ where }) : 0;
  }

  /** Cet étudiant est-il éligible ? Inscription VERIFIED de l'année de l'élection, dans l'institution, qui satisfait une règle. */
  async isEligible(election: { id: string; institutionId: string; academicYearId: string }, studentId: string): Promise<boolean> {
    const where = eligibleWhere(election, await this.rules(election.id));
    if (!where) return false;
    return (await this.prisma.studentEnrollment.count({ where: { AND: [where, { studentId }] } })) > 0;
  }
}
