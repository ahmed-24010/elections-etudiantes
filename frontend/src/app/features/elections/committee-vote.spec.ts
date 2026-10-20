import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { ElectionDetail } from '../../core/api/elections.api';
import { Turnout } from '../../core/api/voting.api';
import { Role } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { settle, translocoTesting } from '../../testing';
import { CommitteeVotePage } from './committee-vote-page';
import { toLocalInput } from './election-ui';

const API = '/api/v1';

@Component({ template: '' })
class Blank {}

const election = (over: Partial<ElectionDetail> = {}): ElectionDetail => ({
  id: 'e1', institutionId: 'inst-1', academicYearId: 'y1', title: 'Bureau du groupe A', titleAr: null, description: null, status: 'VOTING_OPEN',
  candidacyStartsAt: null, candidacyEndsAt: null, votingStartsAt: '2026-11-02T08:00:00.000Z', votingEndsAt: '2026-11-04T18:00:00.000Z', positions: [], ...over,
});
const turnout = (over: Partial<Turnout> = {}): Turnout => ({
  registered: 30, voted: 12, rate: 40, asOf: '2026-11-03T10:15:00.000Z', sliced: true, status: 'VOTING_OPEN',
  votingStartsAt: '2026-11-02T08:00:00.000Z', votingEndsAt: '2026-11-04T18:00:00.000Z', extended: false, addedAfterFreeze: 0, ...over,
});

async function load(role: Role, e: ElectionDetail, t: Turnout | null = turnout()) {
  TestBed.configureTestingModule({
    imports: [translocoTesting()],
    providers: [
      provideRouter([{ path: '**', component: Blank }]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'e1' }) } } },
    ],
  });
  TestBed.inject(AuthService).user.set({ id: 'u', email: 'a@example.test', phone: null, twoFactorEnabled: true, roles: [{ role, institutionId: 'inst-1', electionId: role === 'ELECTION_COMMITTEE' ? 'e1' : null }] });
  const http = TestBed.inject(HttpTestingController);
  const page = TestBed.createComponent(CommitteeVotePage) as ComponentFixture<unknown>;
  page.detectChanges();
  const el = page.nativeElement as HTMLElement;
  const reply = async (url: string, body: object, status = 200) => {
    await settle(page);
    http.expectOne(url).flush(body, { status, statusText: 'x' });
    await settle(page);
  };
  await reply(`${API}/elections/e1`, e);
  if (t) await reply(`${API}/elections/e1/turnout`, t);
  const q = (testid: string) => el.querySelector<HTMLElement>(`[data-testid=${testid}]`);
  const btn = (testid: string) => q(testid) as HTMLButtonElement;
  const type = (selector: string, value: string) => {
    const f = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
    f.value = value;
    f.dispatchEvent(new Event('input'));
    page.detectChanges();
  };
  const submit = async (formId: string) => {
    el.querySelector<HTMLFormElement>(`#${formId}`)!.dispatchEvent(new Event('submit'));
    await settle(page);
  };
  return { http, page, el, reply, q, btn, type, submit };
}

describe('Suivi du vote (comité)', () => {
  it('affiche inscrits, votants et taux : des chiffres, jamais de noms (D-02)', async () => {
    const { q, el } = await load('ELECTION_COMMITTEE', election());
    expect(q('registered')!.textContent).toContain('30');
    expect(q('voted')!.textContent).toContain('12');
    expect(q('rate')!.textContent).toContain('40');
    expect(el.querySelector('table, ul.voters')).toBeNull();
  });

  it('sous 50 électeurs : la tranche de 15 minutes est annoncée (D-31) ; au-delà, non', async () => {
    const small = await load('ELECTION_COMMITTEE', election());
    expect(small.q('sliced')).not.toBeNull();
    TestBed.resetTestingModule();
    const big = await load('ELECTION_COMMITTEE', election(), turnout({ sliced: false, registered: 800, voted: 300, rate: 37.5 }));
    expect(big.q('sliced')).toBeNull();
    expect(big.q('rate')!.textContent).toContain('37.5');
  });

  it('actualiser relit le serveur', async () => {
    const { btn, reply, q, page } = await load('ELECTION_COMMITTEE', election());
    btn('refresh').click();
    page.detectChanges();
    await reply(`${API}/elections/e1/turnout`, turnout({ voted: 15, rate: 50 }));
    expect(q('voted')!.textContent).toContain('15');
  });

  it('les ajouts exceptionnels sont comptés', async () => {
    expect((await load('ELECTION_COMMITTEE', election(), turnout({ addedAfterFreeze: 2 }))).q('added')).not.toBeNull();
    TestBed.resetTestingModule();
    expect((await load('ELECTION_COMMITTEE', election(), turnout({ addedAfterFreeze: 0 }))).q('added')).toBeNull();
  });

  it('avant le vote : pas de chiffres, le message l’explique', async () => {
    const { q, el, http } = await load('ELECTION_COMMITTEE', election({ status: 'CANDIDACY_OPEN' }), null);
    expect(q('tracking')).toBeNull();
    expect(el.textContent).toContain('committeeVote.notAvailable');
    http.verify();
  });
});

describe('Ouvrir et fermer le vote (🔐)', () => {
  it('ouverture : le serveur refuse, les conditions manquantes sont listées', async () => {
    const { btn, http, page, q, reply } = await load('ELECTION_COMMITTEE', election({ status: 'CANDIDACY_CLOSED' }), null);
    btn('open').click();
    await settle(page);
    http.expectOne(`${API}/elections/e1/voting/open`).flush({ message: 'conditions_not_met', conditions: ['candidacies_pending', 'committee_incomplete'] }, { status: 409, statusText: 'x' });
    await settle(page);
    await reply(`${API}/elections/e1`, election({ status: 'CANDIDACY_CLOSED' })); // page périmée : rechargée après le 409
    expect(q('error')).not.toBeNull();
    expect(q('conditions')!.textContent).toContain('committeeVote.conditions.candidacies_pending');
    expect(q('conditions')!.textContent).toContain('committeeVote.conditions.committee_incomplete');
  });

  it('ouverture réussie : l’écran passe au suivi', async () => {
    const { btn, http, page, q, reply } = await load('ELECTION_COMMITTEE', election({ status: 'CANDIDACY_CLOSED' }), null);
    btn('open').click();
    await settle(page);
    http.expectOne(`${API}/elections/e1/voting/open`).flush({ status: 'VOTING_OPEN' });
    await settle(page);
    await reply(`${API}/elections/e1`, election());
    await reply(`${API}/elections/e1/turnout`, turnout());
    expect(q('notice')).not.toBeNull();
    expect(q('tracking')).not.toBeNull();
    expect(q('open')).toBeNull();
  });

  it('clôture anticipée : le motif est obligatoire avant l’envoi', async () => {
    const { btn, type, submit, http, page } = await load('ELECTION_COMMITTEE', election());
    btn('close').click();
    page.detectChanges();
    expect(btn('close-submit').disabled).toBeTrue();
    type('#close-reason', 'Tous les inscrits ont voté');
    expect(btn('close-submit').disabled).toBeFalse();
    await submit('close-form');
    const req = http.expectOne(`${API}/elections/e1/voting/close`);
    expect(req.request.body).toEqual({ reason: 'Tous les inscrits ont voté' });
    req.flush({ status: 'VOTING_CLOSED' });
  });
});

describe('Prolongation unique après panne (D-33, D-38)', () => {
  const fill = (type: (s: string, v: string) => void) => {
    type('#extend-outageStart', '2026-11-03 09:00');
    type('#extend-outageEnd', '2026-11-03 10:30');
    type('#extend-newEnd', '2026-11-04 19:30');
    type('#extend-reason', 'Panne du serveur');
  };

  it('envoie la panne déclarée, la nouvelle fin et le motif (en ISO) ; le bouton attend un formulaire valide', async () => {
    const { btn, type, submit, http, page, reply, q } = await load('ELECTION_COMMITTEE', election());
    btn('extend').click();
    page.detectChanges();
    expect(btn('extend-submit').disabled).toBeTrue();
    type('#extend-outageStart', '03/11/2026'); // format invalide
    expect(btn('extend-submit').disabled).toBeTrue();
    fill(type);
    expect(btn('extend-submit').disabled).toBeFalse();
    await submit('extend-form');
    const req = http.expectOne(`${API}/elections/e1/voting/extend`);
    expect(req.request.body).toEqual({
      outageStartedAt: new Date('2026-11-03T09:00').toISOString(),
      outageEndedAt: new Date('2026-11-03T10:30').toISOString(),
      newEndsAt: new Date('2026-11-04T19:30').toISOString(),
      reason: 'Panne du serveur',
    });
    req.flush({ votingEndsAt: req.request.body.newEndsAt });
    await settle(page);
    await reply(`${API}/elections/e1`, election());
    await reply(`${API}/elections/e1/turnout`, turnout({ extended: true }));
    expect(q('notice')).not.toBeNull();
    expect(q('extended')).not.toBeNull();
    expect(q('extend')).toBeNull(); // une seule fois : le bouton disparaît
    expect(q('already')).not.toBeNull();
  });

  it('le serveur refuse (plus que la panne) : le message s’affiche dans la fenêtre, qui reste remplie', async () => {
    const { btn, type, submit, http, page, q, el } = await load('ELECTION_COMMITTEE', election());
    btn('extend').click();
    page.detectChanges();
    fill(type);
    await submit('extend-form');
    http.expectOne(`${API}/elections/e1/voting/extend`).flush({ message: 'extension_exceeds_outage' }, { status: 422, statusText: 'x' });
    await settle(page);
    expect(q('dialog-error')!.textContent).toContain('errors.extensionExceedsOutage');
    expect(el.querySelector<HTMLInputElement>('#extend-newEnd')!.value).toBe('2026-11-04 19:30');
  });

  it('déjà prolongé : pas de bouton, le message l’explique', async () => {
    const { q } = await load('ELECTION_COMMITTEE', election(), turnout({ extended: true }));
    expect(q('extend')).toBeNull();
    expect(q('already')).not.toBeNull();
  });

  it('une fois le vote clôturé, plus aucune action', async () => {
    const { q } = await load('ELECTION_COMMITTEE', election({ status: 'VOTING_CLOSED' }), turnout({ status: 'VOTING_CLOSED' }));
    expect(q('extend')).toBeNull();
    expect(q('close')).toBeNull();
    expect(q('add-voter')).toBeNull();
  });

  it('l’administrateur d’institution suit et clôture, mais ne prolonge pas et n’ajoute pas d’électeur', async () => {
    const { q } = await load('INSTITUTION_ADMIN', election());
    expect(q('tracking')).not.toBeNull();
    expect(q('close')).not.toBeNull();
    expect(q('extend')).toBeNull();
    expect(q('add-voter')).toBeNull();
  });

  it('toLocalInput reste cohérent avec le format attendu', () => {
    expect(toLocalInput(new Date('2026-11-03T09:00').toISOString())).toBe('2026-11-03 09:00');
  });
});

describe('Ajout exceptionnel d’un électeur (04 §5.2, D-39)', () => {
  const preview = { faculty: { name: 'Droit', nameAr: 'القانون' }, program: { name: 'Droit public', nameAr: null }, level: { name: 'L3', nameAr: null }, group: 'A' };

  it('matricule → confirmation (filière, niveau, groupe, jamais le nom) → motif → ajout', async () => {
    const { btn, type, submit, http, page, q, el, reply } = await load('ELECTION_COMMITTEE', election());
    btn('add-voter').click();
    page.detectChanges();
    expect(btn('lookup-submit').disabled).toBeTrue();
    type('#voter-number', '  20240001 ');
    await submit('lookup-form');
    const lookup = http.expectOne(`${API}/elections/e1/voter-roll/preview`);
    expect(lookup.request.body).toEqual({ studentNumber: '20240001' });
    lookup.flush(preview);
    await settle(page);
    const shown = q('preview')!.textContent ?? '';
    for (const part of ['Droit', 'Droit public', 'L3', 'A']) expect(shown).toContain(part);
    expect(shown).not.toContain('20240001');
    expect(btn('add-submit').disabled).toBeTrue(); // le motif est obligatoire
    type('#add-reason', 'Vérifié en retard par la scolarité');
    await submit('add-form');
    const add = http.expectOne(`${API}/elections/e1/voter-roll`);
    expect(add.request.body).toEqual({ studentNumber: '20240001', reason: 'Vérifié en retard par la scolarité' });
    add.flush({ registered: 31 });
    await settle(page);
    await reply(`${API}/elections/e1/turnout`, turnout({ registered: 31, addedAfterFreeze: 1 }));
    expect(q('notice')).not.toBeNull();
    expect(q('registered')!.textContent).toContain('31');
    expect(el.querySelector('.modal')).toBeNull();
  });

  it('matricule refusé : un seul message, quelle qu’en soit la raison (ne révèle pas son existence)', async () => {
    const { btn, type, submit, http, page, q } = await load('ELECTION_COMMITTEE', election());
    btn('add-voter').click();
    page.detectChanges();
    type('#voter-number', 'INCONNU');
    await submit('lookup-form');
    http.expectOne(`${API}/elections/e1/voter-roll/preview`).flush({ message: 'voter_not_addable' }, { status: 404, statusText: 'x' });
    await settle(page);
    expect(q('dialog-error')!.textContent).toContain('errors.voterNotAddable');
    expect(q('preview')).toBeNull();
  });
});
