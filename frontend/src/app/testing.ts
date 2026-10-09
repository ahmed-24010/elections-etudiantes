import { TranslocoTestingModule } from '@jsverse/transloco';

export const TEST_LANGS = {
  fr: {
    'app.title': 'Élections étudiantes', 'health.ok': 'OK', 'health.down': 'Indisponible',
    'health.unreachable': 'Serveur injoignable', 'health.checking': 'Vérification en cours…',
    'health.title': 't', 'health.api': 'API', 'health.database': 'Base', 'home.title': 'h', 'home.subtitle': 's',
    'nav.language': 'Langue', 'layout.student': 'Espace étudiant', 'layout.admin': 'Administration',
  },
  ar: {
    'app.title': 'الانتخابات الطلابية', 'health.ok': 'تعمل', 'health.down': 'غير متاحة',
    'health.unreachable': 'تعذّر الاتصال', 'health.checking': 'جارٍ التحقق',
    'health.title': 't', 'health.api': 'API', 'health.database': 'DB', 'home.title': 'h', 'home.subtitle': 's',
    'nav.language': 'اللغة', 'layout.student': 'فضاء الطالب', 'layout.admin': 'الإدارة',
  },
};

export const translocoTesting = () =>
  TranslocoTestingModule.forRoot({
    langs: TEST_LANGS,
    translocoConfig: { availableLangs: ['ar', 'fr'], defaultLang: 'fr' },
    preloadLangs: true,
  });
