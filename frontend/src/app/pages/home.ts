import { Component, inject } from '@angular/core';
import { I18nService } from '../core/i18n.service';

@Component({ selector: 'app-home', template: `<h1>{{ i18n.t('home.welcome') }}</h1>` })
export class Home {
  protected readonly i18n = inject(I18nService);
}
