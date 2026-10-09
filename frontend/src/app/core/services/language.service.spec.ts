import { TestBed } from '@angular/core/testing';
import { translocoTesting } from '../../testing';
import { LanguageService } from './language.service';

describe('LanguageService', () => {
  let service: LanguageService;

  beforeEach(() => {
    localStorage.clear();
    const link = document.createElement('link');
    link.id = 'bootstrap-css';
    document.head.appendChild(link);
    TestBed.configureTestingModule({ imports: [translocoTesting()] });
    service = TestBed.inject(LanguageService);
  });
  afterEach(() => document.getElementById('bootstrap-css')?.remove());

  it('arabe : html dir=rtl, lang=ar, feuille Bootstrap RTL', async () => {
    await service.use('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.getElementById('bootstrap-css')?.getAttribute('href')).toContain('bootstrap.rtl.min.css');
    expect(service.dir()).toBe('rtl');
  });

  it('français : html dir=ltr, feuille Bootstrap LTR', async () => {
    await service.use('ar');
    await service.use('fr');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('fr');
    expect(document.getElementById('bootstrap-css')?.getAttribute('href')).toBe('assets/css/bootstrap.min.css');
  });

  it('mémorise la langue choisie et la restaure à init()', async () => {
    await service.use('fr');
    expect(localStorage.getItem('lang')).toBe('fr');
    await service.init();
    expect(service.current()).toBe('fr');
  });

  it('arabe par défaut quand rien n est mémorisé', async () => {
    await service.init();
    expect(service.current()).toBe('ar');
  });
});
