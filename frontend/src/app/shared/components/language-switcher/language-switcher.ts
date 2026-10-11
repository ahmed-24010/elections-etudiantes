import { Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { LANGS, Lang, LanguageService } from '../../../core/services/language.service';
import { IconMenu } from '../icon-menu/icon-menu';

/** 🌐 : menu des langues, la langue actuelle est cochée. */
@Component({
  selector: 'app-language-switcher',
  imports: [TranslocoPipe, IconMenu],
  template: `
    <app-icon-menu [label]="'nav.language' | transloco">
      <svg icon width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
      </svg>
      @for (lang of langs; track lang) {
        <button type="button" class="app-menu-item" [attr.lang]="lang" [attr.aria-current]="language.current() === lang ? 'true' : null" (click)="select(lang)">
          <span class="app-menu-check" aria-hidden="true">{{ language.current() === lang ? '✓' : '' }}</span>
          {{ labels[lang] }}
        </button>
      }
    </app-icon-menu>
  `,
})
export class LanguageSwitcher {
  protected readonly language = inject(LanguageService);
  protected readonly langs = LANGS;
  protected readonly labels: Record<Lang, string> = { ar: 'العربية', fr: 'Français' };

  protected select(lang: Lang) {
    void this.language.use(lang);
  }
}
