import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ElectionStatus } from './elections.api';

export interface DashboardElection {
  id: string;
  title: string;
  titleAr: string | null;
  round: number;
  status: ElectionStatus;
  votingStartsAt: string;
  votingEndsAt: string;
  /** Vote ouvert ou clôturé : des chiffres seulement (D-02) ; sous 50 électeurs, arrêtés à la tranche de 15 minutes (D-31). */
  participation?: { registered: number; voted: number; rate: number; sliced: boolean; asOf: string } | null;
}

export interface DashboardReport {
  electionId: string;
  title: string;
  titleAr: string | null;
  round: number;
  verificationCode?: string;
  generatedAt?: string;
}

/** Tableau de bord de l'administrateur d'institution (D-48) : des chiffres, jamais un nom d'étudiant. */
export interface Dashboard {
  generatedAt: string;
  counts: { candidacyOpen: number; awaitingVote: number; votingOpen: number; awaitingPublication: number; upcoming: number };
  inProgress: DashboardElection[];
  upcoming: DashboardElection[];
  pendingVerifications: number;
  reportsToSign: { count: number; items: DashboardReport[] };
  publishedWithoutReport: { count: number; items: DashboardReport[] };
}

@Injectable({ providedIn: 'root' })
export class DashboardApi {
  private readonly http = inject(HttpClient);
  get(institutionId: string): Promise<Dashboard> {
    return firstValueFrom(this.http.get<Dashboard>(`${environment.apiUrl}/institutions/${institutionId}/dashboard`));
  }
}
