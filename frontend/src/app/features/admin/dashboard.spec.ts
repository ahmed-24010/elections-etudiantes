import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Dashboard } from '../../core/api/dashboard.api';
import { Role } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { settle, translocoTesting } from '../../testing';
import { DashboardPage } from './dashboard-page';

const API = '/api/v1';

@Component({ template: '' })
class Blank {}

const election = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: `Élection ${id}`, titleAr: null, round: 1, status: 'VOTING_OPEN' as const, votingStartsAt: '2026-11-02T08:00:00.000Z', votingEndsAt: '2026-11-04T18:00:00.000Z', ...over,
});
const dashboard = (over: Partial<Dashboard> = {}): Dashboard => ({
  generatedAt: '2026-11-03T10:00:00.000Z',
  counts: { candidacyOpen: 1, awaitingVote: 0, votingOpen: 2, awaitingPublication: 1, upcoming: 1 },
  inProgress: [
    election('a', { participation: { registered: 30, voted: 12, rate: 40, sliced: true, asOf: '2026-11-03T09:45:00.000Z' } }),
    election('b', { status: 'VOTING_CLOSED', participation: { registered: 800, voted: 600, rate: 75, sliced: false, asOf: '2026-11-03T10:00:00.000Z' } }),
    election('c', { status: 'CANDIDACY_OPEN', round: 2 }),
  ],
  upcoming: [election('d', { status: 'DRAFT' })],
  pendingVerifications: 7,
  reportsToSign: { count: 1, items: [{ electionId: 'e', title: 'Élection e', titleAr: null, round: 1, verificationCode: 'PV-7D9E2C145A3B', generatedAt: '2026-11-04T19:00:00.000Z' }] },
  publishedWithoutReport: { count: 1, items: [{ electionId: 'f', title: 'Élection f', titleAr: null, round: 1 }] },
  ...over,
});

async function load(role: Role, body: Dashboard | { status: number }) {
  TestBed.configureTestingModule({ imports: [translocoTesting()], providers: [provideRouter([{ path: '**', component: Blank }]), provideHttpClient(), provideHttpClientTesting()] });
  TestBed.inject(AuthService).user.set({ id: 'u', email: 'ia@example.test', phone: null, twoFactorEnabled: true, roles: [{ role, institutionId: 'inst-1', electionId: null }] });
  const http = TestBed.inject(HttpTestingController);
  const page = TestBed.createComponent(DashboardPage) as ComponentFixture<unknown>;
  page.detectChanges();
  await settle(page);
  if ('status' in body) http.expectOne(`${API}/institutions/inst-1/dashboard`).flush({ message: 'x' }, { status: body.status, statusText: 'x' });
  else http.expectOne(`${API}/institutions/inst-1/dashboard`).flush(body);
  await settle(page);
  const el = page.nativeElement as HTMLElement;
  return { http, page, el, q: (id: string) => el.querySelector<HTMLElement>(`[data-testid=${id}]`) };
}

describe('Tableau de bord de l’administrateur d’institution (D-48)', () => {
  it('quatre chiffres : votes ouverts, à venir, inscriptions à vérifier, PV à signer', async () => {
    const { q } = await load('INSTITUTION_ADMIN', dashboard());
    expect(q('count-voting')!.textContent).toContain('2');
    expect(q('count-upcoming')!.textContent).toContain('1');
    expect(q('count-verifications')!.textContent).toContain('7');
    expect(q('count-reports')!.textContent).toContain('1');
  });

  it('élections en cours : participation en chiffres ; tranche de 15 min annoncée sous 50 électeurs ; pastille du second tour', async () => {
    const { q } = await load('INSTITUTION_ADMIN', dashboard());
    const small = q('election-a')!;
    expect(small.querySelector('[data-testid=participation]')!.textContent).toContain('12');
    expect(small.querySelector('[data-testid=participation]')!.textContent).toContain('dashboard.asOf');
    expect(q('election-b')!.querySelector('[data-testid=participation]')!.textContent).not.toContain('dashboard.asOf');
    expect(q('election-b')!.querySelector('[data-testid=participation]')!.textContent).toContain('600');
    expect(q('election-c')!.textContent).toContain('dashboard.round');
    expect(q('election-c')!.querySelector('[data-testid=participation]')).toBeNull();
  });

  it('PV à signer : élection et code ; publications sans PV signalées avec un lien', async () => {
    const { q } = await load('INSTITUTION_ADMIN', dashboard());
    expect(q('report-e')!.textContent).toContain('PV-7D9E2C145A3B');
    expect(q('without-report')).not.toBeNull();
    expect(q('without-report')!.querySelector('a[href="/admin/elections/f/results"]')).not.toBeNull();
  });

  it('rien en cours, rien à signer : messages vides, pas d’avertissement', async () => {
    const { q } = await load('INSTITUTION_ADMIN', dashboard({ inProgress: [], upcoming: [], reportsToSign: { count: 0, items: [] }, publishedWithoutReport: { count: 0, items: [] }, pendingVerifications: 0, counts: { candidacyOpen: 0, awaitingVote: 0, votingOpen: 0, awaitingPublication: 0, upcoming: 0 } }));
    expect(q('none-in-progress')).not.toBeNull();
    expect(q('none-to-sign')).not.toBeNull();
    expect(q('without-report')).toBeNull();
  });

  it('aucune liste nominative : l’écran n’affiche ni nom ni e-mail', async () => {
    const { el } = await load('INSTITUTION_ADMIN', dashboard());
    expect(el.textContent).not.toMatch(/@/);
    expect(el.querySelector('table')).toBeNull();
  });

  it('erreur du serveur (403) : message, pas de chiffres', async () => {
    const { q } = await load('INSTITUTION_ADMIN', { status: 403 });
    expect(q('error')).not.toBeNull();
    expect(q('counts')).toBeNull();
  });
});
