import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { ElectionDetail } from '../../core/api/elections.api';
import { ReportSummary } from '../../core/api/reports.api';
import { ResultsView, UrnCheck } from '../../core/api/results.api';
import { Role } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { LanguageService } from '../../core/services/language.service';
import { settle, translocoTesting } from '../../testing';
import { CommitteeResultsPage } from './committee-results-page';

const API = '/api/v1';

@Component({ template: '' })
class Blank {}

const election = (status: ElectionDetail['status'], over: Partial<ElectionDetail> = {}): ElectionDetail => ({
  id: 'e1', institutionId: 'inst-1', academicYearId: 'y1', title: 'Bureau du groupe A', titleAr: null, description: null, status,
  candidacyStartsAt: null, candidacyEndsAt: null, votingStartsAt: '2026-11-02T08:00:00.000Z', votingEndsAt: '2026-11-04T18:00:00.000Z', positions: [], ...over,
});
const person = (id: string, firstName: string, lastName: string) => ({ candidateId: id, firstName, lastName, fullNameAr: null });
const results = (over: Partial<ResultsView> = {}): ResultsView => ({
  electionId: 'e1', status: 'VOTING_CLOSED', registered: 31, voters: 22, participationRate: 71, integrityOk: true,
  positions: [
    { positionId: 'p1', title: 'Président', titleAr: 'الرئيس', seats: 1, tie: false, winners: [person('c1', 'Omar', 'Diallo')], detailPublished: true, blank: 2,
      candidates: [{ ...person('c1', 'Omar', 'Diallo'), votes: 12, rank: 1, isWinner: true }, { ...person('c2', 'Aïcha', 'Ba'), votes: 8, rank: 2, isWinner: false }] },
    { positionId: 'p2', title: 'Vice-président', titleAr: null, seats: 1, tie: true, winners: [], detailPublished: true, blank: 0,
      candidates: [{ ...person('c3', 'Sara', 'Fall'), votes: 11, rank: 1, isWinner: false }, { ...person('c4', 'Éric', 'Ndiaye'), votes: 11, rank: 1, isWinner: false }] },
  ], ...over,
});
const report = (over: Partial<ReportSummary> = {}): ReportSummary => ({
  reportId: '7d9e2c14-5a3b-4f8e-9c21-0b6a8d4e1f73', verificationCode: 'PV-7D9E2C145A3B', generatedAt: '2026-11-04T19:01:00.000Z', ballotsDigest: 'a'.repeat(64),
  sha256: { fr: 'b'.repeat(64), ar: 'c'.repeat(64) }, revoked: false, signedAt: null, ...over,
});
const urn = (over: Partial<UrnCheck> = {}): UrnCheck => ({
  computedDigest: 'a'.repeat(64), tallyDigest: 'a'.repeat(64), reportDigest: 'a'.repeat(64), reportId: 'r1', matchesTally: true, matchesReport: true, checkedAt: '2026-11-05T08:00:00.000Z', ...over,
});

async function load(role: Role, status: ElectionDetail['status'], opts: { results?: ResultsView | null; reports?: ReportSummary[]; lang?: 'fr' | 'ar'; election?: Partial<ElectionDetail> } = {}) {
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
  if (opts.lang) TestBed.inject(LanguageService).current.set(opts.lang);
  const http = TestBed.inject(HttpTestingController);
  const page = TestBed.createComponent(CommitteeResultsPage) as ComponentFixture<unknown>;
  page.detectChanges();
  const el = page.nativeElement as HTMLElement;
  const reply = async (url: string, body: object | Blob, status = 200) => {
    await settle(page);
    http.expectOne((r) => r.url === url).flush(body, { status, statusText: 'x' });
    await settle(page);
  };
  await reply(`${API}/elections/e1`, election(status, opts.election));
  if (status === 'VOTING_CLOSED' || status === 'RESULTS_PUBLISHED') {
    await reply(`${API}/results/e1`, opts.results ?? results({ status }));
    if (status === 'RESULTS_PUBLISHED') await reply(`${API}/elections/e1/reports`, opts.reports ?? [report()]);
  }
  const q = (testid: string) => el.querySelector<HTMLElement>(`[data-testid=${testid}]`);
  const btn = (testid: string) => q(testid) as HTMLButtonElement;
  return { http, page, el, reply, q, btn };
}

describe('Résultats (comité)', () => {
  it('affiche participation, intégrité réussie, résultats par poste ; l’égalité est signalée', async () => {
    const { q } = await load('ELECTION_COMMITTEE', 'VOTING_CLOSED');
    expect(q('registered')!.textContent).toContain('31');
    expect(q('voters')!.textContent).toContain('22');
    expect(q('integrity-ok')).not.toBeNull();
    expect(q('position-p1')!.textContent).toContain('Omar Diallo');
    expect(q('ties')).not.toBeNull();
    expect(q('position-p2')!.querySelector('[data-testid=tie-badge]')).not.toBeNull();
    expect(q('position-p1')!.querySelector('[data-testid=tie-badge]')).toBeNull();
  });

  it('intégrité échouée : alerte, et le serveur refusera la publication', async () => {
    const { q } = await load('ELECTION_COMMITTEE', 'VOTING_CLOSED', { results: results({ integrityOk: false }) });
    expect(q('integrity-failed')).not.toBeNull();
    expect(q('integrity-ok')).toBeNull();
  });

  it('sous 3 votants, le détail est masqué : seuls les élus (D-32)', async () => {
    const withheld = results({ positions: [{ positionId: 'p1', title: 'Président', titleAr: null, seats: 1, tie: false, winners: [person('c1', 'Omar', 'Diallo')], detailPublished: false, note: 'DETAIL_WITHHELD_SMALL_TURNOUT' }] });
    const { q } = await load('ELECTION_COMMITTEE', 'VOTING_CLOSED', { results: withheld });
    expect(q('withheld')).not.toBeNull();
    expect(q('position-p1')!.textContent).toContain('Omar Diallo');
    expect(q('position-p1')!.textContent).not.toContain('12');
  });

  describe('publication (D-41)', () => {
    it('le comité publie, avec confirmation ; le PV est ensuite listé', async () => {
      const { btn, q, http, page, reply } = await load('ELECTION_COMMITTEE', 'VOTING_CLOSED');
      btn('publish').click();
      page.detectChanges();
      btn('publish-confirm').click();
      await settle(page);
      http.expectOne(`${API}/elections/e1/results/publish`).flush({ status: 'RESULTS_PUBLISHED', report: 'generated' });
      await settle(page);
      await reply(`${API}/elections/e1`, election('RESULTS_PUBLISHED'));
      await reply(`${API}/results/e1`, results({ status: 'RESULTS_PUBLISHED' }));
      await reply(`${API}/elections/e1/reports`, [report()]);
      expect(q('notice')).not.toBeNull();
      expect(q('publish')).toBeNull();
      expect(q('report-code')!.textContent).toContain('PV-7D9E2C145A3B');
    });

    it('conditions manquantes (urne modifiée, chaîne d’audit rompue) : listées, rien n’est publié', async () => {
      const { btn, q, http, page } = await load('ELECTION_COMMITTEE', 'VOTING_CLOSED');
      btn('publish').click();
      page.detectChanges();
      btn('publish-confirm').click();
      await settle(page);
      http.expectOne(`${API}/elections/e1/results/publish`).flush({ message: 'conditions_not_met', conditions: ['tally_stale', 'audit_chain_broken'] }, { status: 409, statusText: 'x' });
      await settle(page);
      expect(q('error')).not.toBeNull();
      expect(q('conditions')!.textContent).toContain('committeeResults.conditions.tally_stale');
      expect(q('conditions')!.textContent).toContain('committeeResults.conditions.audit_chain_broken');
      expect(q('publish')).not.toBeNull(); // toujours possible une fois le problème réglé
    });

    it('l’administrateur d’institution ne publie pas : pas de bouton', async () => {
      const { q } = await load('INSTITUTION_ADMIN', 'VOTING_CLOSED');
      expect(q('publish')).toBeNull();
      expect(q('summary')).not.toBeNull();
      expect(q('verify')).not.toBeNull();
    });

    it('avant la clôture du vote : aucun résultat, le message l’explique', async () => {
      const { q, http } = await load('ELECTION_COMMITTEE', 'VOTING_OPEN');
      expect(q('not-available')).not.toBeNull();
      expect(q('summary')).toBeNull();
      expect(q('verify')).toBeNull();
      http.verify();
    });
  });

  describe('procès-verbal (D-42)', () => {
    it('le bouton principal télécharge la langue du site ; le second, l’autre langue', async () => {
      for (const [site, other] of [['fr', 'ar'], ['ar', 'fr']] as const) {
        TestBed.resetTestingModule();
        const { btn, q, http, page } = await load('ELECTION_COMMITTEE', 'RESULTS_PUBLISHED', { lang: site });
        expect(q('download')!.textContent).toContain(`committeeResults.download.${site}`);
        expect(q('download-other')!.textContent).toContain(`committeeResults.download.${other}`);
        btn('download').click();
        await settle(page);
        const req = http.expectOne((r) => r.url === `${API}/elections/e1/report/download`);
        expect(req.request.params.get('lang')).toBe(site);
        expect(req.request.responseType).toBe('blob');
        req.flush(new Blob(['%PDF-1.4'], { type: 'application/pdf' }));
        await settle(page);
      }
    });

    it('sans PV (génération échouée) : message et bouton « Créer le procès-verbal »', async () => {
      const { q } = await load('ELECTION_COMMITTEE', 'RESULTS_PUBLISHED', { reports: [] });
      expect(q('no-report')).not.toBeNull();
      expect(q('download')).toBeNull();
      expect(q('regenerate')!.textContent).toContain('committeeResults.generate');
    });

    it('l’administrateur d’institution regénère le PV (🔐) puis la liste est rechargée', async () => {
      const { btn, q, http, page, reply } = await load('INSTITUTION_ADMIN', 'RESULTS_PUBLISHED');
      btn('regenerate').click();
      await settle(page);
      http.expectOne(`${API}/elections/e1/report`).flush(report({ reportId: 'new', verificationCode: 'PV-NEWCODE00000' }));
      await settle(page);
      await reply(`${API}/elections/e1/reports`, [report({ reportId: 'new', verificationCode: 'PV-NEWCODE00000' }), report()]);
      expect(q('report-code')!.textContent).toContain('PV-NEWCODE00000');
      expect(q('notice')).not.toBeNull();
    });
  });

  describe('Vérifier l’urne (D-45)', () => {
    it('identique : message de confirmation et empreintes en police à chasse fixe', async () => {
      const { btn, q, reply, page } = await load('ELECTION_COMMITTEE', 'RESULTS_PUBLISHED');
      btn('verify').click();
      await settle(page);
      await reply(`${API}/results/e1/verify`, urn());
      expect(q('urn-identical')).not.toBeNull();
      expect(q('urn-different')).toBeNull();
      expect(q('digest-computed')!.textContent!.trim()).toBe('a'.repeat(64));
      expect(q('digest-report')!.textContent!.trim()).toBe('a'.repeat(64));
    });

    it('différente : alerte rouge, jamais « identique » (ni pour le décompte, ni pour le PV)', async () => {
      for (const over of [{ matchesTally: false, matchesReport: false, computedDigest: 'd'.repeat(64) }, { matchesTally: true, matchesReport: false }]) {
        TestBed.resetTestingModule();
        const { btn, q, reply, page } = await load('ELECTION_COMMITTEE', 'RESULTS_PUBLISHED');
        btn('verify').click();
        await settle(page);
        await reply(`${API}/results/e1/verify`, urn(over));
        expect(q('urn-different')).not.toBeNull();
        expect(q('urn-identical')).toBeNull();
      }
    });

    it('sans PV : comparée au décompte seulement', async () => {
      const { btn, q, reply, page } = await load('ELECTION_COMMITTEE', 'VOTING_CLOSED');
      btn('verify').click();
      await settle(page);
      await reply(`${API}/results/e1/verify`, urn({ matchesReport: null, reportDigest: null, reportId: null }));
      expect(q('urn-identical')!.textContent).toContain('committeeResults.urnIdenticalTally');
      expect(q('digest-report')!.textContent).toContain('—');
    });
  });

  describe('second tour (D-01, D-46)', () => {
    it('égalité + résultats publiés : le comité crée le second tour en un clic, dates préremplies, 🔐, puis le lien apparaît', async () => {
      const { btn, q, el, http, page, reply } = await load('ELECTION_COMMITTEE', 'RESULTS_PUBLISHED');
      btn('second-round').click();
      page.detectChanges();
      const start = el.querySelector<HTMLInputElement>('#sr-votingStartsAt')!.value;
      const end = el.querySelector<HTMLInputElement>('#sr-votingEndsAt')!.value;
      expect(start).toMatch(/^\d{4}-\d{2}-\d{2} 08:00$/); // le lendemain, 8 h
      expect(end).toMatch(/^\d{4}-\d{2}-\d{2} 18:00$/);
      expect(btn('second-round-confirm').disabled).toBeFalse(); // un seul clic suffit
      btn('second-round-confirm').click();
      await settle(page);
      const req = http.expectOne(`${API}/elections/e1/second-round`);
      expect(req.request.body).toEqual({ votingStartsAt: new Date(start.replace(' ', 'T')).toISOString(), votingEndsAt: new Date(end.replace(' ', 'T')).toISOString() });
      req.flush({ id: 'e2', round: 2, status: 'CANDIDACY_CLOSED' });
      await settle(page);
      await reply(`${API}/elections/e1`, election('RESULTS_PUBLISHED', { secondRound: { id: 'e2', status: 'CANDIDACY_CLOSED', round: 2 } }));
      expect(q('notice')).not.toBeNull();
      expect(q('second-round')).toBeNull();
      expect(q('second-round-link')).not.toBeNull();
    });

    it('refus du serveur (dates) : le message s’affiche dans la fenêtre, qui reste ouverte et remplie', async () => {
      const { btn, q, el, http, page } = await load('ELECTION_COMMITTEE', 'RESULTS_PUBLISHED');
      btn('second-round').click();
      page.detectChanges();
      btn('second-round-confirm').click();
      await settle(page);
      http.expectOne(`${API}/elections/e1/second-round`).flush({ message: 'invalid_dates' }, { status: 400, statusText: 'x' });
      await settle(page);
      expect(q('dialog-error')).not.toBeNull();
      expect(el.querySelector<HTMLInputElement>('#sr-votingStartsAt')!.value).not.toBe('');
    });

    it('un second tour existe déjà : lien vers lui, plus de bouton de création', async () => {
      const { q } = await load('ELECTION_COMMITTEE', 'RESULTS_PUBLISHED', { election: { secondRound: { id: 'e2', status: 'VOTING_OPEN', round: 2 } } });
      expect(q('second-round')).toBeNull();
      expect(q('second-round-link')).not.toBeNull();
    });

    it('administrateur d’institution : pas de bouton, seulement la mention « comité seulement »', async () => {
      const { q } = await load('INSTITUTION_ADMIN', 'RESULTS_PUBLISHED');
      expect(q('second-round')).toBeNull();
      expect(q('second-round-committee-only')).not.toBeNull();
    });

    it('résultats non publiés (VOTING_CLOSED) : pas de création de second tour', async () => {
      const { q } = await load('ELECTION_COMMITTEE', 'VOTING_CLOSED');
      expect(q('ties')).not.toBeNull();
      expect(q('second-round')).toBeNull();
    });
  });

  describe('« PV signé » (D-47)', () => {
    it('le comité marque le PV signé (🔐) : le bouton laisse place à la date de signature', async () => {
      const { btn, q, http, page, reply } = await load('ELECTION_COMMITTEE', 'RESULTS_PUBLISHED');
      expect(q('signed')).toBeNull();
      btn('sign').click();
      await settle(page);
      http.expectOne(`${API}/elections/e1/report/signed`).flush({ reportId: 'r', signedAt: '2026-11-05T10:00:00.000Z' });
      await settle(page);
      await reply(`${API}/elections/e1/reports`, [report({ signedAt: '2026-11-05T10:00:00.000Z' })]);
      expect(q('signed')).not.toBeNull();
      expect(q('sign')).toBeNull();
    });

    it('déjà signé : pas de bouton ; administrateur d’institution : voit « pas encore signé », sans bouton', async () => {
      const signed = await load('ELECTION_COMMITTEE', 'RESULTS_PUBLISHED', { reports: [report({ signedAt: '2026-11-05T10:00:00.000Z' })] });
      expect(signed.q('sign')).toBeNull();
      expect(signed.q('signed')).not.toBeNull();
      TestBed.resetTestingModule();
      const ia = await load('INSTITUTION_ADMIN', 'RESULTS_PUBLISHED');
      expect(ia.q('sign')).toBeNull();
      expect(ia.q('not-signed')).not.toBeNull();
    });
  });
});
