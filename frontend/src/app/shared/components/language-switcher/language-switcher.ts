import { Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { LANGS, Lang, LanguageService } from '../../../core/services/language.service';

@Component({
  selector: 'app-language-switcher',
  imports: [TranslocoPipe],
  template: `
    <div class="btn-group btn-group-sm" role="group" [attr.aria-label]="'nav.language' | transloco">
      @for (lang of langs; track lang) {
        <button
          type="button"
          class="btn btn-outline-light"
          [class.active]="language.current() === lang"
          [attr.aria-pressed]="language.current() === lang"
          [attr.lang]="lang"
          (click)="select(lang)"
        >{{ labels[lang] }}</button>
      }
    </div>
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
