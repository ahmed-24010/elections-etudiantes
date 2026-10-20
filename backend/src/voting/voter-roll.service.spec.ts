import { ConflictException, NotFoundException } from '@nestjs/common';
import { ElectionStatus, Prisma } from '@prisma/client';
import type { AuthUser } from '../common/authz/auth-user';
import { VoterRollService } from './voter-roll.service';

const election = { id: 'e1', institutionId: 'i1', academicYearId: 'y1', status: ElectionStatus.VOTING_OPEN };
const enrollment = {
  id: 'en1', facultyId: 'f', programId: 'p', levelId: 'l', groupId: 'g',
  faculty: { name: 'Droit', nameAr: 'القانون' }, program: { name: 'Droit public', nameAr: null }, level: { name: 'L3', nameAr: null }, group: { name: 'A' },
};
const actor = { id: 'u1' } as AuthUser;

interface Over {
  election?: unknown;
  student?: unknown;
  enrollment?: unknown;
  rules?: unknown[];
  onRoll?: unknown;
  createError?: unknown;
}

/** Faux Prisma : chaque cas ne change que ce qui diffère du cas nominal (étudiant actif, vérifié, éligible, pas encore inscrit). */
function setup(over: Over = {}) {
  const db = {
    election: { findUnique: jest.fn().mockResolvedValue('election' in over ? over.election : election) },
    student: { findUnique: jest.fn().mockResolvedValue('student' in over ? over.student : { id: 's1', user: { status: 'ACTIVE' } }) },
    studentEnrollment: { findFirst: jest.fn().mockResolvedValue('enrollment' in over ? over.enrollment : enrollment) },
    eligibilityRule: { findMany: jest.fn().mockResolvedValue(over.rules ?? [{ facultyId: null, programId: 'p', levelId: 'l', groupId: null }]) },
    voterRollEntry: {
      findUnique: jest.fn().mockResolvedValue(over.onRoll ?? null),
      create: over.createError ? jest.fn().mockRejectedValue(over.createError) : jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(31),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'e1' }]),
  };
  const prisma = { ...db, $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(db)) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  return { db, audit, service: new VoterRollService(prisma as never, audit as never) };
}

const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as NotFoundException;
  }
  throw new Error('aucun refus');
};

describe('VoterRollService (04 §5.2, D-39)', () => {
  it('la confirmation montre filière, niveau et groupe, sans nom ni identifiant', async () => {
    const { service } = setup();
    const preview = await service.preview('e1', ' 20240001 ');
    expect(preview).toEqual({ faculty: enrollment.faculty, program: enrollment.program, level: enrollment.level, group: 'A' });
    expect(JSON.stringify(preview)).not.toMatch(/s1|en1|20240001/);
  });

  it('refuse hors VOTING_OPEN (409), avant même de regarder le matricule', async () => {
    const { service, db } = setup({ election: { ...election, status: ElectionStatus.VOTING_CLOSED } });
    expect(await refusal(service.preview('e1', 'x'))).toBeInstanceOf(ConflictException);
    expect(db.student.findUnique).not.toHaveBeenCalled();
  });

  describe('tous les refus liés au matricule sont identiques (ne révèlent pas son existence)', () => {
    const cases: [string, Over][] = [
      ['matricule inconnu', { student: null }],
      ['compte suspendu', { student: { id: 's1', user: { status: 'SUSPENDED' } } }],
      ['inscription non vérifiée ou absente', { enrollment: null }],
      ['hors des règles d’éligibilité', { rules: [{ facultyId: null, programId: 'autre', levelId: null, groupId: null }] }],
      ['aucune règle', { rules: [] }],
      ['déjà sur la liste', { onRoll: { studentId: 's1' } }],
    ];
    it.each(cases)('aperçu : %s', async (_name, over) => {
      const e = await refusal(setup(over).service.preview('e1', 'x'));
      expect(e).toBeInstanceOf(NotFoundException);
      expect(e.getStatus()).toBe(404);
      expect(e.getResponse()).toMatchObject({ message: 'voter_not_addable' });
    });
    it.each(cases)('ajout : %s', async (_name, over) => {
      const { service, db, audit } = setup(over);
      const e = await refusal(service.add(actor, 'e1', 'x', 'oubli'));
      expect(e.getResponse()).toMatchObject({ message: 'voter_not_addable' });
      expect(db.voterRollEntry.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
    it('ajout : course sur la clé primaire (P2002) → même refus', async () => {
      const createError = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 't' });
      const e = await refusal(setup({ createError }).service.add(actor, 'e1', 'x', 'oubli'));
      expect(e.getResponse()).toMatchObject({ message: 'voter_not_addable' });
    });
  });

  it('l’ajout inscrit l’électeur (addedAfterFreeze) et trace le motif sans nom ni matricule', async () => {
    const { service, db, audit } = setup();
    const res = await service.add(actor, 'e1', '20240001', 'oublié par la scolarité', { ip: '1.2.3.4', requestId: 'r1' } as never);
    expect(res).toEqual({ registered: 31 });
    expect(db.voterRollEntry.create).toHaveBeenCalledWith({ data: { electionId: 'e1', studentId: 's1', enrollmentId: 'en1', addedAfterFreeze: true } });
    const entry = audit.record.mock.calls[0][0];
    expect(entry).toMatchObject({ actorId: 'u1', institutionId: 'i1', action: 'ELECTION_VOTER_ADDED', resourceId: 'e1', metadata: { reason: 'oublié par la scolarité', enrollmentId: 'en1' } });
    expect(JSON.stringify(entry)).not.toMatch(/20240001|"s1"/); // ni matricule ni identifiant d'étudiant
  });
});
