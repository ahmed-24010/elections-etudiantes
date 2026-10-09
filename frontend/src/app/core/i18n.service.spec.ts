import { TestBed } from '@angular/core/testing';
import { I18nService } from './i18n.service';

describe('I18nService', () => {
  beforeEach(() => localStorage.clear());

  it('passe en arabe : dir=rtl et traductions arabes', () => {
    const s = TestBed.inject(I18nService);
    s.set('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
    expect(s.t('nav.login')).toBe('تسجيل الدخول');
  });

  it('repasse en français : dir=ltr', () => {
    const s = TestBed.inject(I18nService);
    s.set('fr');
    expect(document.documentElement.dir).toBe('ltr');
    expect(s.t('nav.login')).toBe('Connexion');
  });

  it('renvoie la clé si la traduction manque', () => {
    expect(TestBed.inject(I18nService).t('inconnu')).toBe('inconnu');
  });
});
