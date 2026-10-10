import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from '../../core/auth/auth.service';
import { translocoTesting } from '../../testing';
import { LoginPage } from './login-page';
import { RegisterPage } from './register-page';
import { TwoFactorSetupPage } from './two-factor-setup-page';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function configure(authMock: Partial<Record<keyof AuthService, unknown>>, query: Record<string, string> = {}) {
  TestBed.configureTestingModule({
    imports: [translocoTesting()],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: { homeUrl: () => '/student', ...authMock } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: (k: string) => query[k] ?? null } } } },
    ],
  });
}

const type = (el: HTMLElement, selector: string, value: string) => {
  const input = el.querySelector<HTMLInputElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
};

describe('LoginPage', () => {
  it('ne soumet pas un formulaire vide', async () => {
    const login = jasmine.createSpy('login');
    configure({ login });
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('button[type=submit]') as HTMLButtonElement;
    expect(button.disabled).toBeTrue();
    expect(login).not.toHaveBeenCalled();
  });

  it('connexion réussie : redirige vers l’espace de l’utilisateur', async () => {
    const login = jasmine.createSpy('login').and.resolveTo('authenticated');
    configure({ login });
    const navigateByUrl = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    type(el, '#identifier', 'alice@example.test');
    type(el, '#password', 'mot-de-passe-long');
    fixture.detectChanges();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await flush();
    expect(login).toHaveBeenCalledWith('alice@example.test', 'mot-de-passe-long', undefined);
    expect(navigateByUrl).toHaveBeenCalledWith('/student');
  });

  it('retourne à la page demandée si elle est interne, jamais vers un autre site', async () => {
    for (const [returnUrl, expected] of [['/student/profil', '/student/profil'], ['https://evil.example', '/student'], ['//evil.example', '/student']]) {
      TestBed.resetTestingModule();
      configure({ login: jasmine.createSpy().and.resolveTo('authenticated') }, { returnUrl });
      const navigateByUrl = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
      const fixture = TestBed.createComponent(LoginPage);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      type(el, '#identifier', 'a@example.test');
      type(el, '#password', 'x');
      el.querySelector('form')!.dispatchEvent(new Event('submit'));
      await flush();
      expect(navigateByUrl).toHaveBeenCalledWith(expected);
    }
  });

  it('2FA active : affiche le champ de code, puis renvoie mot de passe + code', async () => {
    const login = jasmine.createSpy('login').and.resolveTo('two_factor_required');
    configure({ login });
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    type(el, '#identifier', 'admin@example.test');
    type(el, '#password', 'mot-de-passe-long');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await flush();
    fixture.detectChanges();
    expect(el.querySelector('#totp')).toBeTruthy();
    expect(el.querySelector('#password')).toBeNull();

    login.and.resolveTo('authenticated');
    spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    type(el, '#totp', '123456');
    fixture.detectChanges();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await flush();
    expect(login).toHaveBeenCalledWith('admin@example.test', 'mot-de-passe-long', '123456');
  });

  it('admin sans 2FA : redirigé vers la configuration de la 2FA', async () => {
    configure({ login: jasmine.createSpy().and.resolveTo('two_factor_setup_required') });
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    type(el, '#identifier', 'admin@example.test');
    type(el, '#password', 'x');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await flush();
    expect(navigate).toHaveBeenCalledWith(['/2fa-setup']);
  });

  it('identifiants incorrects et trop de tentatives : messages traduits, sans détail technique', async () => {
    const login = jasmine.createSpy('login').and.rejectWith(new HttpErrorResponse({ status: 401, error: { message: 'invalid_credentials' } }));
    configure({ login });
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    type(el, '#identifier', 'a@example.test');
    type(el, '#password', 'x');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await flush();
    fixture.detectChanges();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Identifiants incorrects');

    login.and.rejectWith(new HttpErrorResponse({ status: 429 }));
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await flush();
    fixture.detectChanges();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Trop de tentatives');
  });
});

describe('RegisterPage', () => {
  const institutions = [{ code: 'DEMO', name: 'Institution de test' }];

  async function create(register = jasmine.createSpy('register').and.resolveTo()) {
    configure({ institutions: () => Promise.resolve(institutions), register });
    const fixture = TestBed.createComponent(RegisterPage);
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, register };
  }

  it('liste les institutions publiques (nom affiché, code envoyé)', async () => {
    const { el } = await create();
    const options = Array.from(el.querySelectorAll('#institution option')).map((o) => [(o as HTMLOptionElement).value, o.textContent?.trim()]);
    expect(options).toContain(['DEMO', 'Institution de test']);
  });

  it('impose 10 caractères minimum et un e-mail ou un téléphone', async () => {
    const { fixture, el, register } = await create();
    const select = el.querySelector<HTMLSelectElement>('#institution')!;
    select.value = 'DEMO';
    select.dispatchEvent(new Event('change'));
    type(el, '#password', '123456789'); // 9 caractères
    fixture.detectChanges();
    const submit = el.querySelector<HTMLButtonElement>('button[type=submit]')!;
    expect(submit.disabled).toBeTrue();
    type(el, '#email', 'alice@example.test');
    fixture.detectChanges();
    expect(submit.disabled).toBeTrue(); // mot de passe encore trop court
    type(el, '#password', '1234567890');
    fixture.detectChanges();
    expect(submit.disabled).toBeFalse();
    expect(register).not.toHaveBeenCalled();
  });

  it('sans e-mail ni téléphone, le formulaire reste invalide', async () => {
    const { fixture, el } = await create();
    const select = el.querySelector<HTMLSelectElement>('#institution')!;
    select.value = 'DEMO';
    select.dispatchEvent(new Event('change'));
    type(el, '#password', 'un-mot-de-passe-long');
    fixture.detectChanges();
    expect(el.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBeTrue();
  });

  it('envoie les données et affiche le même message de succès (le serveur ne révèle pas si le compte existait)', async () => {
    const { fixture, el, register } = await create();
    const select = el.querySelector<HTMLSelectElement>('#institution')!;
    select.value = 'DEMO';
    select.dispatchEvent(new Event('change'));
    type(el, '#email', 'alice@example.test');
    type(el, '#password', 'un-mot-de-passe-long');
    fixture.detectChanges();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await flush();
    fixture.detectChanges();
    expect(register).toHaveBeenCalledWith({ email: 'alice@example.test', password: 'un-mot-de-passe-long', institutionCode: 'DEMO' });
    expect(el.querySelector('[role=status]')?.textContent).toContain('Inscription enregistrée');
  });
});

describe('TwoFactorSetupPage', () => {
  it('démarre la configuration, affiche la clé et le QR code, active avec un code à 6 chiffres', async () => {
    const enableTwoFactor = jasmine.createSpy('enable').and.resolveTo();
    configure({
      startTwoFactorSetup: () => Promise.resolve({ secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP' }),
      enableTwoFactor,
    });
    const navigateByUrl = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    const fixture = TestBed.createComponent(TwoFactorSetupPage);
    fixture.detectChanges();
    await flush();
    await new Promise((r) => setTimeout(r, 200)); // chargement paresseux de la bibliothèque de QR code
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('code')?.textContent).toContain('JBSWY3DPEHPK3PXP');
    expect(el.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png;base64,/);

    const submit = el.querySelector<HTMLButtonElement>('button[type=submit]')!;
    type(el, '#code', '12ab');
    fixture.detectChanges();
    expect(submit.disabled).toBeTrue();
    type(el, '#code', '123456');
    fixture.detectChanges();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await flush();
    expect(enableTwoFactor).toHaveBeenCalledWith('123456');
    expect(navigateByUrl).toHaveBeenCalledWith('/student');
  });

  it('code refusé : message d’erreur, pas de redirection', async () => {
    configure({
      startTwoFactorSetup: () => Promise.resolve({ secret: 'S', otpauthUri: 'otpauth://totp/x?secret=S' }),
      enableTwoFactor: () => Promise.reject(new HttpErrorResponse({ status: 400, error: { message: 'invalid_code' } })),
    });
    const navigateByUrl = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    const fixture = TestBed.createComponent(TwoFactorSetupPage);
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    type(el, '#code', '000000');
    fixture.detectChanges();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await flush();
    fixture.detectChanges();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Code incorrect');
    expect(navigateByUrl).not.toHaveBeenCalled();
  });
});
