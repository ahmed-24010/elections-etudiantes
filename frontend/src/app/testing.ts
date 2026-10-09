import { HttpTestingController, TestRequest } from '@angular/common/http/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';

// Clés d'authentification utilisées par les tests (en français pour les deux langues : seul le texte des tests compte).
const AUTH_FR = {
  'auth.logout': 'Déconnexion', 'auth.login.title': 'Connexion', 'auth.login.submit': 'Se connecter',
  'auth.login.totpHint': 'Saisissez le code.', 'auth.register.title': 'Inscription', 'auth.register.submit': 'Créer mon compte',
  'auth.register.done': 'Inscription enregistrée', 'auth.register.emailOrPhone': 'Au moins un', 'auth.register.passwordHint': '{{min}} caractères minimum.',
  'auth.identifier': 'Identifiant', 'auth.password': 'Mot de passe', 'auth.code': 'Code', 'auth.email': 'E-mail', 'auth.phone': 'Téléphone',
  'auth.institution': 'Institution', 'auth.institutionPlaceholder': 'Choisir', 'auth.login.noAccount': 'Pas de compte ?',
  'auth.register.haveAccount': 'Déjà inscrit ?', 'auth.twoFactor.title': 'Activer la 2FA', 'auth.twoFactor.intro': 'Scannez.',
  'auth.twoFactor.qrAlt': 'QR', 'auth.twoFactor.manual': 'Clé :', 'auth.twoFactor.submit': 'Activer', 'common.loading': 'Chargement',
  'errors.generic': 'Erreur générique', 'errors.network': 'Réseau', 'errors.tooMany': 'Trop de tentatives',
  'errors.invalidCredentials': 'Identifiants incorrects', 'errors.invalidCode': 'Code incorrect',
  'errors.invalidInstitution': 'Institution invalide', 'errors.sessionExpired': 'Session expirée',
};

export const TEST_LANGS = {
  fr: {
    'app.title': 'Élections étudiantes', 'health.ok': 'OK', 'health.down': 'Indisponible',
    'health.unreachable': 'Serveur injoignable', 'health.checking': 'Vérification en cours…',
    'health.title': 't', 'health.api': 'API', 'health.database': 'Base', 'home.title': 'h', 'home.subtitle': 's',
    'nav.language': 'Langue', 'layout.student': 'Espace étudiant', 'layout.admin': 'Administration',
    ...AUTH_FR,
  },
  ar: {
    'app.title': 'الانتخابات الطلابية', 'health.ok': 'تعمل', 'health.down': 'غير متاحة',
    'health.unreachable': 'تعذّر الاتصال', 'health.checking': 'جارٍ التحقق',
    'health.title': 't', 'health.api': 'API', 'health.database': 'DB', 'home.title': 'h', 'home.subtitle': 's',
    'nav.language': 'اللغة', 'layout.student': 'فضاء الطالب', 'layout.admin': 'الإدارة',
    ...AUTH_FR,
  },
};

export const translocoTesting = () =>
  TranslocoTestingModule.forRoot({
    langs: TEST_LANGS,
    translocoConfig: { availableLangs: ['ar', 'fr'], defaultLang: 'fr' },
    preloadLangs: true,
  });

/**
 * Attend qu'une requête HTTP soit émise. Le renouvellement du jeton passe par Web Locks (asynchrone) : la requête
 * /auth/refresh n'est pas envoyée au même instant que l'appel.
 */
export async function waitForRequest(ctrl: HttpTestingController, url: string, timeoutMs = 1000): Promise<TestRequest> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const [req] = ctrl.match(url);
    if (req) return req;
    if (Date.now() > end) throw new Error(`Aucune requête vers ${url}`);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}
