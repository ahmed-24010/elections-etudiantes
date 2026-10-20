import { PvLang } from './pv-data';

/** Textes du procès-verbal. Aucun texte en dur dans le gabarit : tout passe par ce tableau, une langue par document (D-42). */
export interface PvLabels {
  dir: 'ltr' | 'rtl';
  lang: PvLang;
  title: string;
  documentSubtitle: string;
  institution: string;
  round: (n: number) => string;
  s1: string;
  registered: string;
  voters: string;
  ballots: string;
  turnout: string;
  ofWhichAdded: (n: number) => string;
  winnersLabel: (n: number) => string;
  integrityOk: string;
  s2: string;
  votingStart: string;
  votingEnd: string;
  publishedAt: string;
  incidentTitle: string;
  noIncident: string;
  originalEnd: string;
  outage: string;
  outageRange: (from: string, to: string) => string;
  newEnd: string;
  reason: string;
  s3: string;
  seats: (n: number) => string;
  votes: string;
  elected: string;
  blank: string;
  withheld: string;
  winnersOnly: string;
  tieBadge: string;
  tieText: (seatsLeft: number) => string;
  tieNext: string;
  s4: string;
  digestTitle: string;
  digestHelp: string;
  reportId: string;
  verificationCode: string;
  generatedAt: string;
  signaturesTitle: string;
  signaturesHelp: string;
  name: string;
  signature: string;
  member: (n: number) => string;
  observations: string;
  page: string;
  of: string;
  utc: string;
  none: string;
  sep: string;
}

/** Nombre + nom en arabe : 1 → singulier, 2 → duel, 3 à 10 → pluriel, au-delà → singulier avec le chiffre. */
function arCount(n: number, one: string, two: string, few: string, oneText?: string): string {
  if (n === 1) return oneText ?? `${one} واحدة`;
  if (n === 2) return two;
  return n >= 3 && n <= 10 ? `${n} ${few}` : `${n} ${one}`;
}

export const PV_LABELS: Record<PvLang, PvLabels> = {
  fr: {
    dir: 'ltr',
    lang: 'fr',
    title: 'Procès-verbal des résultats',
    documentSubtitle: 'Élections étudiantes',
    institution: 'Institution',
    round: (n) => `Tour ${n}`,
    s1: 'Participation',
    registered: 'Inscrits',
    voters: 'Votants',
    ballots: 'Bulletins',
    turnout: 'Participation',
    ofWhichAdded: (n) => `dont ${n} ${n > 1 ? 'ajouts exceptionnels' : 'ajout exceptionnel'} après le gel de la liste électorale`,
    winnersLabel: (n) => (n > 1 ? 'Élus' : 'Élu(e)'),
    integrityOk: 'Contrôle d’intégrité réussi : votants = bulletins, et votants au plus égaux aux inscrits.',
    s2: 'Calendrier et incident',
    votingStart: 'Ouverture du vote',
    votingEnd: 'Clôture du vote',
    publishedAt: 'Publication des résultats',
    incidentTitle: 'Prolongation après panne',
    noIncident: 'Aucune prolongation : le vote s’est terminé à l’heure prévue.',
    originalEnd: 'Fin initiale',
    outage: 'Panne déclarée',
    outageRange: (a, b) => `du ${a} au ${b}`,
    newEnd: 'Nouvelle fin',
    reason: 'Motif',
    s3: 'Résultats par poste',
    seats: (n) => `${n} siège${n > 1 ? 's' : ''}`,
    votes: 'voix',
    elected: 'Élu(e)',
    blank: 'Votes blancs',
    withheld: 'Effectif trop faible pour publier le détail des voix.',
    winnersOnly: 'Élu(s)',
    tieBadge: 'Égalité — second tour',
    tieText: (left) => `Égalité pour le dernier siège ; ${left} siège${left > 1 ? 's' : ''} à pourvoir. Un second tour limité à ces candidats est à organiser, avec la même liste électorale.`,
    tieNext: '',
    s4: 'Intégrité et signatures',
    digestTitle: 'Empreinte de l’urne (SHA-256)',
    digestHelp: 'Calculée sur la liste triée de tous les bulletins avec leurs choix, sans aucun lien avec les électeurs.',
    reportId: 'Identifiant du rapport',
    verificationCode: 'Code de vérification',
    generatedAt: 'Généré le',
    signaturesTitle: 'Comité électoral',
    signaturesHelp: 'Les membres du comité attestent l’exactitude des chiffres ci-dessus.',
    name: 'Nom',
    signature: 'Signature',
    member: (n) => `Membre ${n}`,
    observations: 'Observations',
    page: 'Page',
    of: '/',
    utc: 'UTC',
    none: '—',
    sep: ', ',
  },
  ar: {
    dir: 'rtl',
    lang: 'ar',
    title: 'محضر نتائج الانتخابات',
    documentSubtitle: 'الانتخابات الطلابية',
    institution: 'المؤسسة',
    round: (n) => `الدور ${n}`,
    s1: 'المشاركة',
    registered: 'المسجّلون',
    voters: 'المصوّتون',
    ballots: 'الأوراق',
    turnout: 'المشاركة',
    ofWhichAdded: (n) => `منهم ${arCount(n, 'إضافة استثنائية', 'إضافتان استثنائيتان', 'إضافات استثنائية')} بعد تجميد القائمة الانتخابية`,
    winnersLabel: (n) => (n === 1 ? 'الفائز' : n === 2 ? 'الفائزان' : 'الفائزون'),
    integrityOk: 'نجحت مراقبة السلامة: عدد المصوّتين = عدد الأوراق، وعدد المصوّتين لا يتجاوز عدد المسجّلين.',
    s2: 'الجدول الزمني والحوادث',
    votingStart: 'بداية التصويت',
    votingEnd: 'نهاية التصويت',
    publishedAt: 'نشر النتائج',
    incidentTitle: 'التمديد بعد عطل',
    noIncident: 'لا تمديد: انتهى التصويت في الوقت المحدد.',
    originalEnd: 'النهاية الأصلية',
    outage: 'العطل المصرّح به',
    outageRange: (a, b) => `من ${a} إلى ${b}`,
    newEnd: 'النهاية الجديدة',
    reason: 'السبب',
    s3: 'النتائج حسب المنصب',
    seats: (n) => arCount(n, 'مقعد', 'مقعدان', 'مقاعد', 'مقعد واحد'),
    votes: 'صوت',
    elected: 'الفائز',
    blank: 'الأصوات البيضاء',
    withheld: 'عدد المصوّتين قليل جدًا لنشر تفاصيل الأصوات.',
    winnersOnly: 'الفائزون',
    tieBadge: 'تعادل — دور ثانٍ',
    tieText: (left) => `تعادل على المقعد الأخير؛ ${arCount(left, 'مقعد', 'مقعدان', 'مقاعد', 'مقعد واحد')} شاغر. يجب تنظيم دور ثانٍ يقتصر على هؤلاء المرشحين، بالقائمة الانتخابية نفسها.`,
    tieNext: '',
    s4: 'السلامة والتوقيعات',
    digestTitle: 'بصمة الصندوق (SHA-256)',
    digestHelp: 'محسوبة على قائمة مرتبة لجميع الأوراق مع اختياراتها، دون أي صلة بالناخبين.',
    reportId: 'معرّف التقرير',
    verificationCode: 'رمز التحقق',
    generatedAt: 'تاريخ الإنشاء',
    signaturesTitle: 'لجنة الانتخابات',
    signaturesHelp: 'يشهد أعضاء اللجنة بصحة الأرقام أعلاه.',
    name: 'الاسم',
    signature: 'التوقيع',
    member: (n) => `العضو ${n}`,
    observations: 'ملاحظات',
    page: 'صفحة',
    of: '/',
    utc: 'التوقيت العالمي',
    none: '—',
    sep: '، ',
  },
};
