import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Role } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { translocoTesting } from '../../testing';
import { AdminLayout } from './admin-layout';

@Component({ template: '' })
class Page {}

function create(...roles: Role[]) {
  TestBed.configureTestingModule({ imports: [AdminLayout, translocoTesting()], providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  TestBed.inject(AuthService).user.set({ id: 'u', email: 'a@example.test', phone: null, twoFactorEnabled: true, roles: roles.map((role) => ({ role, institutionId: 'i', electionId: null })) });
  const fixture = TestBed.createComponent(AdminLayout);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const links = () => Array.from(el.querySelectorAll('.app-sidebar a')).map((a) => a.getAttribute('href'));
  const titles = () => Array.from(el.querySelectorAll('.app-sidebar-title')).map((t) => t.textContent!.trim());
  return { fixture, el, links, titles };
}

describe('Layout d’administration : menu latéral', () => {
  it('administrateur d’institution : section « Structure académique » (cinq pages), pas « Vérification »', () => {
    const { links, titles } = create('INSTITUTION_ADMIN');
    expect(titles()).toEqual(['nav.academic', 'nav.electionsSection']);
    expect(links()).toEqual(['/admin/academic/years', '/admin/academic/faculties', '/admin/academic/programs', '/admin/academic/levels', '/admin/academic/groups', '/admin/elections']);
  });

  it('comité d’élection : section « Élections » seulement', () => {
    const { links, titles } = create('ELECTION_COMMITTEE');
    expect(titles()).toEqual(['nav.electionsSection']);
    expect(links()).toEqual(['/admin/elections']);
  });

  it('vérificateur : section « Vérification » (Inscriptions) seulement', () => {
    const { links, titles } = create('VERIFICATION_OFFICER');
    expect(titles()).toEqual(['nav.verification']);
    expect(links()).toEqual(['/admin/verification']);
  });

  it('deux rôles : les deux sections ; super administrateur : ni menu ni bouton ☰', () => {
    expect(create('INSTITUTION_ADMIN', 'VERIFICATION_OFFICER').titles()).toEqual(['nav.academic', 'nav.electionsSection', 'nav.verification']);
    TestBed.resetTestingModule();
    const sa = create('SUPER_ADMIN');
    expect(sa.el.querySelector('.app-sidebar')).toBeNull();
    expect(sa.el.querySelector('[aria-controls=admin-sidebar]')).toBeNull();
  });

  it('☰ replie et rouvre le menu (aria-expanded suit)', () => {
    const { fixture, el } = create('INSTITUTION_ADMIN');
    const burger = el.querySelector<HTMLButtonElement>('[aria-controls=admin-sidebar]')!;
    const open = () => !el.querySelector('.app-sidebar')!.classList.contains('is-collapsed');
    const initial = open(); // ouvert sur grand écran, replié sur mobile
    expect(burger.getAttribute('aria-expanded')).toBe(String(initial));
    burger.click();
    fixture.detectChanges();
    expect(open()).toBe(!initial);
    expect(burger.getAttribute('aria-expanded')).toBe(String(!initial));
    burger.click();
    fixture.detectChanges();
    expect(open()).toBe(initial);
  });

  it('la barre du haut est pleine largeur (container-fluid) et le menu est avant le contenu dans le DOM (début de lecture : droite en arabe)', () => {
    const { el } = create('INSTITUTION_ADMIN');
    expect(el.querySelector('app-header .container-fluid')).toBeTruthy();
    const children = Array.from(el.querySelector('.app-admin')!.children).map((c) => c.tagName.toLowerCase());
    expect(children.indexOf('aside')).toBeLessThan(children.indexOf('main'));
  });
});

describe('Layout d administration : page actuelle et tiroir mobile', () => {
  it('la page actuelle est marquée (classe active + aria-current) ; les autres non', async () => {
    TestBed.configureTestingModule({
      imports: [AdminLayout, translocoTesting()],
      providers: [provideRouter([{ path: 'admin/academic/faculties', component: Page }]), provideHttpClient(), provideHttpClientTesting()],
    });
    TestBed.inject(AuthService).user.set({ id: 'u', email: 'a@example.test', phone: null, twoFactorEnabled: true, roles: [{ role: 'INSTITUTION_ADMIN', institutionId: 'i', electionId: null }] });
    await TestBed.inject(Router).navigateByUrl('/admin/academic/faculties');
    const fixture = TestBed.createComponent(AdminLayout);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const links = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('.app-sidebar a'));
    const active = links.filter((a) => a.classList.contains('active'));
    expect(active.map((a) => a.getAttribute('href'))).toEqual(['/admin/academic/faculties']);
    expect(active[0].getAttribute('aria-current')).toBe('page');
    expect(links.filter((a) => a.getAttribute('aria-current') === 'page').length).toBe(1);
  });

  it('un bouton × referme le tiroir (affiché seulement sur mobile)', () => {
    const { fixture, el } = create('INSTITUTION_ADMIN');
    const close = el.querySelector<HTMLButtonElement>('.app-sidebar-close')!;
    expect(close).toBeTruthy();
    const aside = el.querySelector('.app-sidebar')!;
    if (aside.classList.contains('is-collapsed')) el.querySelector<HTMLButtonElement>('[aria-controls=admin-sidebar]')!.click();
    fixture.detectChanges();
    close.click();
    fixture.detectChanges();
    expect(aside.classList.contains('is-collapsed')).toBeTrue();
  });
});
