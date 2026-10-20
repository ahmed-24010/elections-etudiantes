import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface ResultPerson {
  candidateId: string;
  firstName: string;
  lastName: string;
  fullNameAr: string | null;
}

/** Un poste. Sous 3 votants, `detailPublished` est faux et il n'y a que les élus (D-32). */
export interface PositionResultView {
  positionId: string;
  title: string;
  titleAr: string | null;
  seats: number;
  tie: boolean;
  winners: ResultPerson[];
  detailPublished: boolean;
  note?: string;
  candidates?: (ResultPerson & { votes: number; rank: number; isWinner: boolean })[];
  blank?: number;
}

export interface ResultsView {
  electionId: string;
  status: string;
  registered: number;
  voters: number;
  participationRate: number;
  /** Personnel seulement : le décompte a-t-il réussi le contrôle d'intégrité ? */
  integrityOk?: boolean;
  positions: PositionResultView[];
}

/** « Vérifier l'urne » (D-45) : empreintes seulement, jamais un bulletin. `matchesReport` est nul tant qu'aucun PV n'existe. */
export interface UrnCheck {
  computedDigest: string;
  tallyDigest: string;
  reportDigest: string | null;
  reportId: string | null;
  matchesTally: boolean;
  matchesReport: boolean | null;
  checkedAt: string;
}

/** Résultats par poste uniquement (D-12), lisibles par les électeurs après publication. */
@Injectable({ providedIn: 'root' })
export class ResultsApi {
  private readonly http = inject(HttpClient);
  get(electionId: string): Promise<ResultsView> {
    return firstValueFrom(this.http.get<ResultsView>(`${environment.apiUrl}/results/${electionId}`));
  }
  /** 🔐 Comité seulement (D-41). Le PV est créé à la publication ; `report: 'failed'` = à regénérer. */
  publish(electionId: string): Promise<{ status: string; report: 'generated' | 'failed' }> {
    return firstValueFrom(this.http.post<{ status: string; report: 'generated' | 'failed' }>(`${environment.apiUrl}/elections/${electionId}/results/publish`, {}));
  }
  verifyUrn(electionId: string): Promise<UrnCheck> {
    return firstValueFrom(this.http.get<UrnCheck>(`${environment.apiUrl}/results/${electionId}/verify`));
  }
}
