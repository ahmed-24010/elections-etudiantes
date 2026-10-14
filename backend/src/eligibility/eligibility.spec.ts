import { randomUUID } from 'crypto';
import { FakePrisma } from '../../test/fake-prisma';
import { EligibilityService, eligibleWhere, isWholeInstitution, RuleCriteria, rulesMatch } from './eligibility.service';

/**
 * Moteur d'éligibilité (02 §5) : les 5 exemples du document, puis les cas limites. Les trois façons de répondre
 * (requête de comptage, test d'un étudiant, évaluation en mémoire) doivent toujours donner la même réponse.
 */
describe('éligibilité (02 §5)', () => {
  const uuid = randomUUID;
  const inst = uuid();
  const otherInst = uuid();
  const year = uuid();
  const otherYear = uuid();
  const fac = uuid();
  const otherFac = uuid();
  const dp = uuid(); // Droit privé
  const dpu = uuid(); // Droit public
  const l2 = uuid();
  const l3 = uuid();
  const gB = uuid(); // DP / L3 / groupe B
  const gA = uuid(); // DP / L3 / groupe A
  const gPu = uuid(); // DPU / L3 / groupe 1

  const prisma = new FakePrisma();
  const service = new EligibilityService(prisma as any);
  const election = { id: uuid(), institutionId: inst, academicYearId: year };
  const students: Record<string, string> = {};

  const enroll = async (name: string, e: { faculty?: string; program: string; level: string; group?: string | null; status?: string; institutionId?: string; yearId?: string }) => {
    const studentId = uuid();
    students[name] = studentId;
    await prisma.studentEnrollment.create({
      data: {
        studentId, institutionId: e.institutionId ?? inst, academicYearId: e.yearId ?? year, facultyId: e.faculty ?? fac, programId: e.program,
        levelId: e.level, groupId: e.group ?? null, status: e.status ?? 'VERIFIED',
      },
    });
  };
  const setRules = async (...rules: RuleCriteria[]) => {
    prisma.eligibilityRule.rows = [];
    for (const r of rules) await prisma.eligibilityRule.create({ data: { electionId: election.id, ...r } });
  };
  const eligible = async () => {
    const names = Object.keys(students);
    const flags = await Promise.all(names.map((n) => service.isEligible(election, students[n])));
    return names.filter((_, i) => flags[i]).sort();
  };
  /** Les trois réponses doivent concorder ; renvoie les noms éligibles. */
  const answer = async (...rules: RuleCriteria[]) => {
    await setRules(...rules);
    const names = await eligible();
    expect(await service.countEligible(election)).toBe(names.length);
    const memory: string[] = [];
    for (const row of prisma.studentEnrollment.rows) {
      const inScope = row.institutionId === inst && row.academicYearId === year && row.status === 'VERIFIED';
      if (inScope && rulesMatch(rules, row as any)) memory.push(Object.keys(students).find((n) => students[n] === row.studentId)!);
    }
    expect(memory.sort()).toEqual(names);
    return names;
  };

  beforeAll(async () => {
    await enroll('b1', { program: dp, level: l3, group: gB });
    await enroll('b2', { program: dp, level: l3, group: gB });
    await enroll('a1', { program: dp, level: l3, group: gA });
    await enroll('pu1', { program: dpu, level: l3, group: gPu });
    await enroll('pu2', { program: dpu, level: l3 }); // sans groupe (D-08)
    await enroll('dp-l2', { program: dp, level: l2, group: null });
    await enroll('autre-fac', { faculty: otherFac, program: uuid(), level: l3 });
    // Hors périmètre : jamais éligibles, quelles que soient les règles
    await enroll('en-attente', { program: dp, level: l3, group: gB, status: 'PENDING' });
    await enroll('rejete', { program: dp, level: l3, group: gB, status: 'REJECTED' });
    await enroll('expire', { program: dp, level: l3, group: gB, status: 'EXPIRED' });
    await enroll('autre-annee', { program: dp, level: l3, group: gB, yearId: otherYear });
    await enroll('autre-institution', { program: dp, level: l3, group: gB, institutionId: otherInst });
  });

  describe('les 5 exemples de 02 §5', () => {
    it('1. Président du groupe B : programme + niveau + groupe', async () => {
      expect(await answer({ programId: dp, levelId: l3, groupId: gB })).toEqual(['b1', 'b2']);
    });

    it('2. Président de promotion L3 Droit privé : programme + niveau (tous les groupes)', async () => {
      expect(await answer({ programId: dp, levelId: l3 })).toEqual(['a1', 'b1', 'b2']);
    });

    it('3. Représentants L3 Droit (deux filières) : deux règles = OU', async () => {
      expect(await answer({ programId: dp, levelId: l3 }, { programId: dpu, levelId: l3 })).toEqual(['a1', 'b1', 'b2', 'pu1', 'pu2']);
    });

    it('4. Conseil étudiant de la faculté : la faculté seule (tous niveaux)', async () => {
      expect(await answer({ facultyId: fac })).toEqual(['a1', 'b1', 'b2', 'dp-l2', 'pu1', 'pu2']);
    });

    it('5. Union étudiante : règle vide = toute l’institution de l’année, vérifiés seulement', async () => {
      expect(await answer({})).toEqual(['a1', 'autre-fac', 'b1', 'b2', 'dp-l2', 'pu1', 'pu2']);
      expect(isWholeInstitution({})).toBe(true);
    });
  });

  describe('cas limites', () => {
    it('zéro règle : personne n’est éligible (jamais « tout le monde » par défaut)', async () => {
      expect(await answer()).toEqual([]);
      expect(await service.countEligible(election)).toBe(0);
      expect(eligibleWhere(election, [])).toBeNull();
    });

    it('un critère de groupe exclut l’étudiant sans groupe ; sans critère de groupe il est inclus', async () => {
      expect(await answer({ programId: dpu, levelId: l3, groupId: gPu })).toEqual(['pu1']);
      expect(await answer({ programId: dpu, levelId: l3 })).toContain('pu2');
    });

    it('ET entre les critères : un seul critère différent suffit à exclure', async () => {
      expect(await answer({ programId: dp, levelId: l2 })).toEqual(['dp-l2']);
      expect(await answer({ facultyId: otherFac, levelId: l2 })).toEqual([]);
    });

    it('seules les inscriptions VERIFIED comptent (PENDING, REJECTED, EXPIRED exclues)', async () => {
      const names = await answer({ programId: dp, levelId: l3, groupId: gB });
      for (const excluded of ['en-attente', 'rejete', 'expire']) expect(names).not.toContain(excluded);
    });

    it('une autre année universitaire et une autre institution ne comptent jamais', async () => {
      const names = await answer({});
      expect(names).not.toContain('autre-annee');
      expect(names).not.toContain('autre-institution');
    });

    it('un étudiant qui satisfait plusieurs règles n’est compté qu’une fois', async () => {
      const names = await answer({ programId: dp, levelId: l3 }, { groupId: gB }, { facultyId: fac });
      expect(names.filter((n) => n === 'b1')).toHaveLength(1);
      expect(await service.countEligible(election)).toBe(names.length);
    });

    it('une règle vide absorbe les autres règles (OU)', async () => {
      expect(await answer({ programId: dp, levelId: l2 }, {})).toEqual(await answer({}));
    });

    it('un identifiant inconnu dans une règle ne donne personne (et ne plante pas)', async () => {
      expect(await answer({ programId: uuid() })).toEqual([]);
    });

    it('un étudiant sans inscription n’est pas éligible', async () => {
      await setRules({});
      expect(await service.isEligible(election, uuid())).toBe(false);
    });

    it('les règles d’une autre élection ne s’appliquent pas', async () => {
      await setRules({});
      expect(await service.countEligible({ ...election, id: uuid() })).toBe(0);
    });

    it('le service ne produit qu’un nombre : aucune liste d’électeurs (D-02)', async () => {
      await setRules({});
      expect(typeof (await service.countEligible(election))).toBe('number');
    });
  });
});
