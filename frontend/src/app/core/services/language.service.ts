import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

export type Lang = 'ar' | 'fr';
export const LANGS: readonly Lang[] = ['ar', 'fr'];
const STORAGE_KEY = 'lang';

@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly doc = inject(DOCUMENT);
  private readonly transloco = inject(TranslocoService);

  readonly current = signal<Lang>('ar');
  readonly dir = computed(() => (this.current() === 'ar' ? 'rtl' : 'ltr'));

  /** Appelé au démarrage : applique la langue mémorisée (arabe par défaut) et attend son chargement. */
  async init(): Promise<void> {
    await this.use(this.stored());
  }

  async use(lang: Lang): Promise<void> {
    this.transloco.setActiveLang(lang);
    await firstValueFrom(this.transloco.load(lang));
    this.current.set(lang);
    const html = this.doc.documentElement;
    html.lang = lang;
    html.dir = lang === 'ar' ? 'rtl' : 'ltr';
    this.doc.getElementById('bootstrap-css')?.setAttribute(
      'href',
      lang === 'ar' ? 'assets/css/bootstrap.rtl.min.css' : 'assets/css/bootstrap.min.css',
    );
    try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* stockage indisponible : on continue */ }
  }

  private stored(): Lang {
    try { return localStorage.getItem(STORAGE_KEY) === 'fr' ? 'fr' : 'ar'; } catch { return 'ar'; }
  }
}
