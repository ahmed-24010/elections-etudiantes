import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { ElectionStatus } from '@prisma/client';
import type { AuthUser } from '../common/authz/auth-user';
import { VotingLifecycleService } from './voting-lifecycle.service';

const H = 3_600_000;
const now = new Date('2026-10-20T14:00:00Z');
const at = (h: number) => new Date(now.getTime() + h * H);
const dto = (over: Record<string, string> = {}) => ({
  outageStartedAt: at(-4).toISOString(), outageEndedAt: at(-2).toISOString(), newEndsAt: at(8).toISOString(), reason: 'panne du serveur', ...over,
});
const actor = { id: 'u1' } as AuthUser;

function setup(election: Record<string, unknown> = {}) {
  const row = { id: 'e1', institutionId: 'i1', status: ElectionStatus.VOTING_OPEN, votingStartsAt: at(-10), votingEndsAt: at(6), votingExtendedAt: null, ...election };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValueOnce([{ id: 'e1' }]).mockResolvedValueOnce([{ now }]),
    election: { findUniqueOrThrow: jest.fn().mockResolvedValue(row), update: jest.fn().mockResolvedValue({}) },
  };
  const prisma = { $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  return { tx, audit, service: new VotingLifecycleService(prisma as never, audit as never, {} as never, {} as never) };
}

describe('VotingLifecycleService.extend (D-33, D-38)', () => {
  it('prolonge, mémorise la fin initiale et audite motif, panne, anciennes et nouvelles dates', async () => {
    const { service, tx, audit } = setup();
    const res = await service.extend(actor, 'e1', dto());
    expect(res.votingEndsAt).toEqual(at(8));
    expect(tx.election.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { votingEndsAt: at(8), votingExtendedAt: now, votingEndsAtOriginal: at(6) } });
    expect(audit.record.mock.calls[0][0]).toMatchObject({
      actorId: 'u1', action: 'ELECTION_VOTING_EXTENDED', resourceId: 'e1',
      metadata: { reason: 'panne du serveur', outageStartedAt: at(-4).toISOString(), outageEndedAt: at(-2).toISOString(), previousEndsAt: at(6).toISOString(), newEndsAt: at(8).toISOString() },
    });
  });

  it('une seule fois : la seconde prolongation est refusée (409 already_extended)', async () => {
    const { service, tx } = setup({ votingExtendedAt: at(-1) });
    await expect(service.extend(actor, 'e1', dto())).rejects.toMatchObject({ response: { message: 'already_extended' } });
    expect(tx.election.update).not.toHaveBeenCalled();
  });

  it.each([ElectionStatus.CANDIDACY_CLOSED, ElectionStatus.VOTING_CLOSED, ElectionStatus.RESULTS_PUBLISHED])('refusée en %s (409)', async (status) => {
    const { service, tx } = setup({ status });
    await expect(service.extend(actor, 'e1', dto())).rejects.toBeInstanceOf(ConflictException);
    expect(tx.election.update).not.toHaveBeenCalled();
  });

  it('refusée une fois l’heure de fin passée, même si la clôture automatique n’a pas encore tourné', async () => {
    const { service } = setup({ votingEndsAt: at(-1) });
    await expect(service.extend(actor, 'e1', dto())).rejects.toMatchObject({ response: { message: 'invalid_state' } });
  });

  it.each([
    ['extension_exceeds_outage', { newEndsAt: at(6 + 2.01).toISOString() }],
    ['extension_not_after_current', { newEndsAt: at(5).toISOString() }],
    ['outage_invalid', { outageEndedAt: at(1).toISOString() }],
  ])('422 %s', async (code, over) => {
    const { service, tx } = setup();
    const e = await service.extend(actor, 'e1', dto(over)).catch((x) => x);
    expect(e).toBeInstanceOf(UnprocessableEntityException);
    expect(e.getResponse()).toMatchObject({ message: code });
    expect(tx.election.update).not.toHaveBeenCalled();
  });

  it('422 extension_exceeds_24h : panne de 40 h mais prolongation limitée à 24 h', async () => {
    const { service } = setup({ votingStartsAt: at(-100), votingEndsAt: at(6) });
    const e = await service
      .extend(actor, 'e1', dto({ outageStartedAt: at(-60).toISOString(), outageEndedAt: at(-20).toISOString(), newEndsAt: at(6 + 24.01).toISOString() }))
      .catch((x) => x);
    expect(e.getResponse()).toMatchObject({ message: 'extension_exceeds_24h' });
  });
});
