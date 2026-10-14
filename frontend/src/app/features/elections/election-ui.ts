import { ElectionStatus } from '../../core/api/elections.api';

/** Classe Bootstrap du badge d'état d'une élection. */
export function statusClass(status: ElectionStatus): string {
  switch (status) {
    case 'DRAFT':
      return 'text-bg-secondary';
    case 'CANDIDACY_OPEN':
      return 'text-bg-success';
    case 'CANDIDACY_CLOSED':
      return 'text-bg-primary';
    case 'CANCELLED':
      return 'text-bg-danger';
    default:
      return 'text-bg-info';
  }
}

export function candidacyClass(status: string): string {
  return status === 'APPROVED' ? 'text-bg-success' : status === 'REJECTED' ? 'text-bg-danger' : status === 'WITHDRAWN' ? 'text-bg-secondary' : 'text-bg-primary';
}

/** Titre à afficher selon la langue : le titre arabe s'il existe, sinon le titre principal. */
export function electionTitle(e: { title: string; titleAr?: string | null }, lang: 'ar' | 'fr'): string {
  return lang === 'ar' && e.titleAr ? e.titleAr : e.title;
}

/** Date et heure saisies en texte « AAAA-MM-JJ HH:mm » (heure locale) : le champ natif suivrait la langue du navigateur. */
export const DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Instant ISO (UTC) à partir d'un texte « AAAA-MM-JJ HH:mm » ; undefined si vide ou invalide. */
export function fromLocalInput(value: string): string | undefined {
  if (!DATETIME.test(value)) return undefined;
  const d = new Date(value.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
