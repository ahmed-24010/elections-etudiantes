import { IsIn } from 'class-validator';

/** Langue du PV à télécharger : celle du site de l'utilisateur (D-42). */
export class ReportLangQuery {
  @IsIn(['fr', 'ar'])
  lang: 'fr' | 'ar';
}
