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
  positions: PositionResultView[];
}

/** Résultats par poste uniquement (D-12), lisibles par les électeurs après publication. */
@Injectable({ providedIn: 'root' })
export class ResultsApi {
  private readonly http = inject(HttpClient);
  get(electionId: string): Promise<ResultsView> {
    return firstValueFrom(this.http.get<ResultsView>(`${environment.apiUrl}/results/${electionId}`));
  }
}
