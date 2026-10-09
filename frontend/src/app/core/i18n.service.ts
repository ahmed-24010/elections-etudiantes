import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';

export type Locale = 'fr' | 'ar';

const DICT: Record<Locale, Record<string, string>> = {
  fr: {
    'app.title': 'Élections étudiantes',
    'nav.login': 'Connexion',
    'nav.home': 'Accueil',
    'nav.logout': 'Déconnexion',
    'login.email': 'E-mail',
    'login.password': 'Mot de passe',
    'login.totp': 'Code 2FA (administrateurs)',
    'login.submit': 'Se connecter',
    'login.error': 'Identifiants invalides',
    'home.welcome': 'Bienvenue',
  },
  ar: {
    'app.title': 'الانتخابات الطلابية',
    'nav.login': 'تسجيل الدخول',
    'nav.home': 'الرئيسية',
    'nav.logout': 'تسجيل الخروج',
    'login.email': 'البريد الإلكتروني',
    'login.password': 'كلمة المرور',
    'login.totp': 'رمز المصادقة الثنائية (للمشرفين)',
    'login.submit': 'دخول',
    'login.error': 'بيانات الدخول غير صحيحة',
    'home.welcome': 'مرحبًا',
  },
};

@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly doc = inject(DOCUMENT);
  readonly locale = signal<Locale>(this.initial());
  readonly dir = computed(() => (this.locale() === 'ar' ? 'rtl' : 'ltr'));

  constructor() {
    this.apply(this.locale());
  }

  t(key: string): string {
    return DICT[this.locale()][key] ?? key;
  }

  set(locale: Locale) {
    this.locale.set(locale);
    try { localStorage.setItem('locale', locale); } catch { /* stockage indisponible */ }
    this.apply(locale);
  }

  private apply(locale: Locale) {
    const el = this.doc.documentElement;
    el.lang = locale;
    el.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }

  private initial(): Locale {
    try {
      const saved = localStorage.getItem('locale');
      if (saved === 'fr' || saved === 'ar') return saved;
    } catch { /* ignore */ }
    return 'fr';
  }
}
