import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig, inject, isDevMode, provideAppInitializer,
  provideBrowserGlobalErrorListeners, provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTransloco } from '@jsverse/transloco';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { AuthService } from './core/auth/auth.service';
import { LanguageService } from './core/services/language.service';
import { TranslocoHttpLoader } from './core/transloco-loader';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideTransloco({
      config: {
        availableLangs: ['ar', 'fr'],
        defaultLang: 'ar',
        fallbackLang: 'fr',
        reRenderOnLangChange: true,
        prodMode: !isDevMode(),
      },
      loader: TranslocoHttpLoader,
    }),
    provideAppInitializer(() => inject(LanguageService).init()),
    // Après un F5, la session revient via le cookie HttpOnly de refresh ; les guards attendent ce résultat.
    provideAppInitializer(() => inject(AuthService).restore()),
  ],
};
