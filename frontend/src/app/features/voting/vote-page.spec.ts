import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Translation, TranslocoTestingModule } from '@jsverse/transloco';
import { Ballot } from '../../core/api/voting.api';
import { LanguageService } from '../../core/services/language.service';
import { settle, waitForRequest } from '../../testing';
import { VotePage } from './vote-page';

type Lang = 'ar' | 'fr';

const person = (id: string, firstName: string) => ({ id, firstName, lastName: 'Test', fullNameAr: null, statement: null, hasPhoto: false, hasProgram: false });
const BALLOT: Ballot = {
  electionId: 'e1',
  title: 'Bureau du groupe 1',
  titleAr: null,
  votingEndsAt: '2026-10-15T18:00:00.000Z',
  positions: [
    { id: 'p1', title: 'Président', titleAr: null, maxChoices: 1, allowBlank: true, candidates: [person('c1', 'Aicha'), person('c2', 'Omar')] },
    { id: 'p2', title: 'Trésorier', titleAr: null, maxChoices: 2, allowBlank: false, candidates: [person('c3', 'Sara'), person('c4', 'Ali'), person('c5', 'Mina')] },
  ],
};

async function json(lang: Lang): Promise<Translation> {
  const res = await fetch(`/assets/i18n/${lang}.json`);
  return res.json();
}

/** Mots qui ressemblent à une clé de traduction brute (« voting.next ») dans le texte et les attributs visibles. */
function rawKeys(root: HTMLElement): string[] {
  const attrs = Array.from(root.querySelectorAll('*')).flatMap((e) => ['alt', 'aria-label', 'placeholder', 'title'].map((a) => e.getAttribute(a) ?? ''));
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: string[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n.textContent ?? '');
  return [...texts, ...attrs].join(' ').split(/[\s·]+/).filter((w) => /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/.test(w));
}

describe('VotePage (écran de vote, D-37)', () => {
  let fixture: ComponentFixture<VotePage>;
  let ctrl: HttpTestingController;
  let langs: Record<Lang, Translation>;
  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent ?? '';
  const q = <T extends HTMLElement>(selector: string) => el().querySelector<T>(selector);
  const click = async (selector: string) => {
    const target = q<HTMLElement>(selector);
    if (!target) throw new Error(`Introuvable : ${selector}`);
    target.click();
    await settle(fixture);
  };

  beforeAll(async () => {
    langs = { fr: await json('fr'), ar: await json('ar') };
  });

  async function start(lang: Lang = 'fr', ballot: Ballot | { status: number; body: object } = BALLOT) {
    TestBed.configureTestingModule({
      imports: [TranslocoTestingModule.forRoot({ langs, translocoConfig: { availableLangs: ['ar', 'fr'], defaultLang: lang, fallbackLang: lang }, preloadLangs: true })],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'e1' }) } } },
      ],
    });
    TestBed.inject(LanguageService).current.set(lang);
    ctrl = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(VotePage);
    fixture.detectChanges();
    const req = await waitForRequest(ctrl, '/api/v1/voting/e1/ballot');
    if ('status' in ballot) req.flush(ballot.body, { status: ballot.status, statusText: 'x' });
    else req.flush(ballot);
    await settle(fixture);
  }

  /** Remplit le bulletin : Omar, puis Sara et Ali ; arrive à l'écran de confirmation. */
  async function reachConfirm() {
    await click('#choice-c2');
    await click('[data-testid=vote-next]');
    await click('#choice-c3');
    await click('#choice-c4');
    await click('[data-testid=vote-next]'); // « Récapitulatif »
    await click('[data-testid=vote-continue]');
  }

  async function typePassword(value: string) {
    const input = q<HTMLInputElement>('#vote-password')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle(fixture);
  }

  afterEach(() => {
    ctrl.verify();
    TestBed.resetTestingModule();
  });

  it('un poste par étape : « Suivant » reste désactivé tant que rien n’est choisi, l’instruction suit maxChoices', async () => {
    await start();
    expect(q('[data-testid=vote-progress]')!.textContent).toContain('1');
    expect(q('[data-testid=vote-instruction]')!.textContent).toContain('un candidat');
    expect(q<HTMLButtonElement>('[data-testid=vote-next]')!.disabled).toBeTrue();
    await click('#choice-c1');
    expect(q<HTMLButtonElement>('[data-testid=vote-next]')!.disabled).toBeFalse();
    await click('[data-testid=vote-next]');
    expect(text()).toContain('Trésorier');
    expect(q('[data-testid=vote-instruction]')!.textContent).toContain('2');
  });

  it('un poste à plusieurs choix : le maximum est respecté (la case en trop est désactivée) ; le vote blanc est interdit s’il n’est pas autorisé', async () => {
    await start();
    await click('#choice-c1');
    await click('[data-testid=vote-next]');
    expect(q('[data-testid=blank-choice]')).toBeNull(); // allowBlank = false sur le trésorier
    await click('#choice-c3');
    await click('#choice-c4');
    expect(q<HTMLInputElement>('#choice-c5')!.disabled).toBeTrue();
    await click('#choice-c4'); // décoche
    expect(q<HTMLInputElement>('#choice-c5')!.disabled).toBeFalse();
  });

  it('le vote blanc est un choix explicite : sans lui, « Suivant » reste désactivé', async () => {
    await start();
    expect(q('[data-testid=blank-choice]')).not.toBeNull();
    expect(q<HTMLButtonElement>('[data-testid=vote-next]')!.disabled).toBeTrue();
    await click('[data-testid=blank-choice] input');
    expect(q<HTMLButtonElement>('[data-testid=vote-next]')!.disabled).toBeFalse();
    await click('[data-testid=vote-next]');
    await click('#choice-c3');
    await click('[data-testid=vote-next]');
    expect(q('[data-testid=summary-p1]')!.textContent).toContain('Vote blanc');
  });

  it('récapitulatif : tous les choix ; « Modifier » ramène au poste puis au récapitulatif', async () => {
    await start();
    await click('#choice-c2');
    await click('[data-testid=vote-next]');
    await click('#choice-c3');
    await click('[data-testid=vote-next]');
    expect(q('[data-testid=summary-p1]')!.textContent).toContain('Omar');
    expect(q('[data-testid=summary-p2]')!.textContent).toContain('Sara');
    const modify = Array.from(el().querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes('Modifier'))!;
    modify.click();
    await settle(fixture);
    await click('#choice-c1');
    expect(q('[data-testid=vote-next]')!.textContent).toContain('Retour au récapitulatif');
    await click('[data-testid=vote-next]');
    expect(q('[data-testid=summary-p1]')!.textContent).toContain('Aicha');
  });

  it('confirmation : avertissement « définitif », mot de passe obligatoire ; envoi du bulletin exact ; écran final sans aucun rappel des choix', async () => {
    await start();
    await reachConfirm();
    expect(q('[data-testid=vote-final]')!.textContent).toContain('définitif');
    expect(q<HTMLButtonElement>('[data-testid=vote-submit]')!.disabled).toBeTrue();
    await typePassword('Un-mot-de-passe-solide-1');
    await click('[data-testid=vote-submit]');
    const post = ctrl.expectOne('/api/v1/voting/e1/ballot');
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({
      choices: [{ positionId: 'p1', candidateIds: ['c2'] }, { positionId: 'p2', candidateIds: ['c3', 'c4'] }],
      password: 'Un-mot-de-passe-solide-1',
    });
    post.flush({ status: 'recorded' });
    (await waitForRequest(ctrl, '/api/v1/voting/e1/status')).flush({ state: 'VOTED', electionStatus: 'VOTING_OPEN', open: true, votingStartsAt: '', votingEndsAt: '', votedAt: '2026-10-15T09:41:00.000Z' });
    await settle(fixture);
    expect(q('[data-testid=vote-done]')!.textContent).toContain('bien été enregistré');
    expect(q('[data-testid=vote-done]')!.textContent).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/); // l'heure
    for (const name of ['Omar', 'Sara', 'Ali', 'Aicha']) expect(text()).not.toContain(name); // pas de reçu des choix
    const page = fixture.componentInstance as unknown as { answers: { getRawValue(): Record<string, { ids: string[]; blank: boolean }> }; form: { getRawValue(): { password: string } } };
    expect(Object.values(page.answers.getRawValue()).every((a) => a.ids.length === 0 && !a.blank)).toBeTrue(); // effacés de la mémoire de la page
    expect(page.form.getRawValue().password).toBe('');
  });

  it('double envoi : un seul POST tant que le premier n’a pas répondu', async () => {
    await start();
    await reachConfirm();
    await typePassword('Un-mot-de-passe-solide-1');
    const form = q<HTMLFormElement>('form')!;
    form.dispatchEvent(new Event('submit'));
    form.dispatchEvent(new Event('submit'));
    await settle(fixture);
    expect(q<HTMLButtonElement>('[data-testid=vote-submit]')!.disabled).toBeTrue();
    ctrl.expectOne('/api/v1/voting/e1/ballot').flush({ status: 'recorded' }); // expectOne échoue s'il y en avait deux
    (await waitForRequest(ctrl, '/api/v1/voting/e1/status')).flush({ state: 'VOTED', votedAt: null });
    await settle(fixture);
  });

  it('mot de passe incorrect : message, le champ est vidé, l’électeur reste sur la confirmation avec son bulletin', async () => {
    await start();
    await reachConfirm();
    await typePassword('faux');
    await click('[data-testid=vote-submit]');
    ctrl.expectOne('/api/v1/voting/e1/ballot').flush({ statusCode: 401, message: 'INVALID_PASSWORD' }, { status: 401, statusText: 'Unauthorized' });
    await settle(fixture);
    expect(q('[data-testid=vote-error]')!.textContent).toContain('Mot de passe incorrect');
    expect((q<HTMLInputElement>('#vote-password')!).value).toBe('');
    await click('button.btn-outline-primary'); // Retour
    expect(q('[data-testid=summary-p1]')!.textContent).toContain('Omar'); // le bulletin est conservé
  });

  it('compte bloqué (429) : message dédié', async () => {
    await start();
    await reachConfirm();
    await typePassword('faux');
    await click('[data-testid=vote-submit]');
    ctrl.expectOne('/api/v1/voting/e1/ballot').flush({ statusCode: 429, message: 'ACCOUNT_LOCKED' }, { status: 429, statusText: 'Too Many Requests' });
    await settle(fixture);
    expect(q('[data-testid=vote-error]')!.textContent).toContain('bloqué');
  });

  it('ALREADY_VOTED (409) : « Votre vote a déjà été enregistré » (04 §6.3)', async () => {
    await start();
    await reachConfirm();
    await typePassword('Un-mot-de-passe-solide-1');
    await click('[data-testid=vote-submit]');
    ctrl.expectOne('/api/v1/voting/e1/ballot').flush({ statusCode: 409, message: 'ALREADY_VOTED' }, { status: 409, statusText: 'Conflict' });
    (await waitForRequest(ctrl, '/api/v1/voting/e1/status')).flush({ state: 'VOTED', votedAt: '2026-10-15T09:41:00.000Z' });
    await settle(fixture);
    expect(q('[data-testid=vote-done]')!.textContent).toContain('déjà été enregistré');
  });

  /** Envoie le bulletin ; la requête de vote reçoit `failure`, puis le statut est interrogé et reçoit `statusReply`. */
  async function failedSend(failure: { status: number; body?: object }, statusReply: { state: string } | 'unreachable') {
    await reachConfirm();
    await typePassword('Un-mot-de-passe-solide-1');
    await click('[data-testid=vote-submit]');
    ctrl.expectOne('/api/v1/voting/e1/ballot').flush(failure.body ?? {}, { status: failure.status, statusText: 'x' });
    const check = await waitForRequest(ctrl, '/api/v1/voting/e1/status');
    if (statusReply === 'unreachable') check.flush({}, { status: 0, statusText: 'x' });
    else check.flush({ ...statusReply, votedAt: null });
    await settle(fixture);
  }
  const noSuccessScreen = () => expect(q('[data-testid=vote-done]')).toBeNull();

  for (const lang of ['fr', 'ar'] as const) {
    const notRecorded = lang === 'fr' ? 'PAS été enregistré' : 'لم يتم تسجيل تصويتك';
    const uncertain = lang === 'fr' ? 'PAS pu être confirmé' : 'تعذر تأكيد';
    for (const [label, failure] of [
      ['erreur serveur 500', { status: 500 }],
      ['réseau coupé', { status: 0 }],
      ['délai dépassé (504)', { status: 504 }],
    ] as const) {
      it(`${label} (${lang}) : « Votre vote n’a PAS été enregistré, réessayez », jamais l’écran de succès`, async () => {
        await start(lang);
        await failedSend(failure, { state: 'NOT_VOTED' });
        noSuccessScreen();
        expect(q('[data-testid=vote-error]')!.textContent).toContain(notRecorded);
        expect(rawKeys(el())).toEqual([]);
        expect(q<HTMLButtonElement>('[data-testid=vote-submit]')!.disabled).toBeFalse(); // on peut réessayer
      });
    }

    it(`serveur injoignable même pour vérifier (${lang}) : message prudent, jamais l’écran de succès, réessai possible`, async () => {
      await start(lang);
      await failedSend({ status: 0 }, 'unreachable');
      noSuccessScreen();
      expect(q('[data-testid=vote-error]')!.textContent).toContain(uncertain);
      expect(q<HTMLButtonElement>('[data-testid=vote-submit]')!.disabled).toBeFalse();
    });
  }

  it('réessai après un échec : le bulletin est conservé ; un second envoi réussi donne l’écran de succès', async () => {
    await start();
    await failedSend({ status: 500 }, { state: 'NOT_VOTED' });
    await typePassword('Un-mot-de-passe-solide-1');
    await click('[data-testid=vote-submit]');
    const post = ctrl.expectOne('/api/v1/voting/e1/ballot');
    expect(post.request.body.choices).toEqual([{ positionId: 'p1', candidateIds: ['c2'] }, { positionId: 'p2', candidateIds: ['c3', 'c4'] }]);
    post.flush({ status: 'recorded' });
    (await waitForRequest(ctrl, '/api/v1/voting/e1/status')).flush({ state: 'VOTED', votedAt: '2026-10-15T09:41:00.000Z' });
    await settle(fixture);
    expect(q('[data-testid=vote-done]')).not.toBeNull();
  });

  it('réponse perdue mais vote enregistré : le serveur le confirme, écran final (c’est la vérité, pas un faux succès)', async () => {
    await start();
    await failedSend({ status: 0 }, { state: 'VOTED' });
    // finish() relit le statut pour l'heure
    (await waitForRequest(ctrl, '/api/v1/voting/e1/status')).flush({ state: 'VOTED', votedAt: '2026-10-15T09:41:00.000Z' });
    await settle(fixture);
    expect(q('[data-testid=vote-done]')).not.toBeNull();
  });

  it('vote fermé pendant la saisie (409 ELECTION_NOT_OPEN) : écran « vote non ouvert », les choix sont effacés', async () => {
    await start();
    await reachConfirm();
    await typePassword('Un-mot-de-passe-solide-1');
    await click('[data-testid=vote-submit]');
    ctrl.expectOne('/api/v1/voting/e1/ballot').flush({ statusCode: 409, message: 'ELECTION_NOT_OPEN' }, { status: 409, statusText: 'Conflict' });
    await settle(fixture);
    expect(q('[data-testid=vote-blocked]')!.textContent).toContain('pas ouvert');
  });

  it('chargement du bulletin : déjà voté → écran final ; hors liste → message ; vote fermé → message', async () => {
    await start('fr', { status: 409, body: { message: 'ALREADY_VOTED' } });
    (await waitForRequest(ctrl, '/api/v1/voting/e1/status')).flush({ state: 'VOTED', votedAt: '2026-10-15T09:41:00.000Z' });
    await settle(fixture);
    expect(q('[data-testid=vote-done]')!.textContent).toContain('déjà été enregistré');
    TestBed.resetTestingModule();

    await start('fr', { status: 403, body: { message: 'NOT_ON_VOTER_ROLL' } });
    expect(q('[data-testid=vote-blocked]')!.textContent).toContain('liste électorale');
    TestBed.resetTestingModule();

    await start('fr', { status: 409, body: { message: 'ELECTION_NOT_OPEN' } });
    expect(q('[data-testid=vote-blocked]')!.textContent).toContain('pas ouvert');
  });

  for (const lang of ['fr', 'ar'] as const) {
    it(`aucune clé de traduction brute à l’écran, sur tout le parcours, en ${lang}`, async () => {
      await start(lang);
      const seen: string[] = [...rawKeys(el())];
      await click('#choice-c2');
      seen.push(...rawKeys(el()));
      await click('[data-testid=vote-next]');
      await click('#choice-c3');
      seen.push(...rawKeys(el()));
      await click('[data-testid=vote-next]');
      seen.push(...rawKeys(el())); // récapitulatif
      await click('[data-testid=vote-continue]');
      seen.push(...rawKeys(el())); // confirmation
      await typePassword('faux');
      await click('[data-testid=vote-submit]');
      ctrl.expectOne('/api/v1/voting/e1/ballot').flush({ message: 'INVALID_PASSWORD' }, { status: 401, statusText: 'Unauthorized' });
      await settle(fixture);
      seen.push(...rawKeys(el())); // erreur
      expect(seen).toEqual([]);
      expect(text()).not.toContain('{{'); // aucune interpolation non résolue
    });
  }
});
