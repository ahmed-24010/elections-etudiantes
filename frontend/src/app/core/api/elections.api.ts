import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

export type ElectionStatus = 'DRAFT' | 'CANDIDACY_OPEN' | 'CANDIDACY_CLOSED' | 'VOTING_OPEN' | 'VOTING_CLOSED' | 'RESULTS_PUBLISHED' | 'CANCELLED';
export type CandidateStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';

export interface ElectionSummary {
  id: string;
  institutionId: string;
  academicYearId: string;
  title: string;
  titleAr: string | null;
  description: string | null;
  status: ElectionStatus;
  candidacyStartsAt: string | null;
  candidacyEndsAt: string | null;
  votingStartsAt: string;
  votingEndsAt: string;
  /** « Mes élections » seulement. */
  myCandidacy?: CandidateStatus | null;
  /** « Mes élections » seulement : l'étudiant a-t-il voté ? Un booléen, jamais le contenu du vote. */
  hasVoted?: boolean;
}

export interface Position {
  id: string;
  title: string;
  titleAr: string | null;
  seats: number;
  maxChoices: number;
  allowBlank: boolean;
  displayOrder: number;
}

export interface RuleItem {
  id?: string;
  facultyId?: string | null;
  programId?: string | null;
  levelId?: string | null;
  groupId?: string | null;
}

/** Détail : l'étudiant ne reçoit ni les règles ni le comité (`rules` et `committeeCount` absents). */
export interface ElectionDetail extends ElectionSummary {
  positions: Position[];
  rules?: { wholeInstitution: boolean; items: RuleItem[] };
  committeeCount?: number;
  minCommittee?: number;
  eligible?: boolean;
}

export interface ElectionBody {
  title: string;
  titleAr?: string;
  description?: string;
  academicYearId?: string;
  candidacyStartsAt?: string;
  candidacyEndsAt?: string;
  votingStartsAt: string;
  votingEndsAt: string;
}

export interface StaffGrant {
  assignmentId: string;
  role: string;
  electionId: string | null;
  user: { id: string; email: string | null; phone: string | null };
}

/** Élections (03 §5.4). Annuler et gérer le comité sont des actions 🔐 : à appeler via StepUpService.run. */
@Injectable({ providedIn: 'root' })
export class ElectionsApi {
  private readonly http = inject(HttpClient);
  private readonly api = environment.apiUrl;

  create(institutionId: string, body: ElectionBody): Promise<ElectionSummary> {
    return firstValueFrom(this.http.post<ElectionSummary>(`${this.api}/institutions/${institutionId}/elections`, body));
  }
  list(institutionId: string): Promise<ElectionSummary[]> {
    return firstValueFrom(this.http.get<ElectionSummary[]>(`${this.api}/institutions/${institutionId}/elections`));
  }
  mine(): Promise<ElectionSummary[]> {
    return firstValueFrom(this.http.get<ElectionSummary[]>(`${this.api}/elections/mine`));
  }
  get(id: string): Promise<ElectionDetail> {
    return firstValueFrom(this.http.get<ElectionDetail>(`${this.api}/elections/${id}`));
  }
  update(id: string, body: Partial<ElectionBody>): Promise<ElectionSummary> {
    return firstValueFrom(this.http.patch<ElectionSummary>(`${this.api}/elections/${id}`, body));
  }
  setRules(id: string, body: { rules: RuleItem[]; wholeInstitution?: boolean }): Promise<ElectionDetail> {
    return firstValueFrom(this.http.put<ElectionDetail>(`${this.api}/elections/${id}/rules`, body));
  }
  addPosition(id: string, body: Partial<Position>): Promise<Position> {
    return firstValueFrom(this.http.post<Position>(`${this.api}/elections/${id}/positions`, body));
  }
  removePosition(id: string, positionId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.api}/elections/${id}/positions/${positionId}`));
  }
  openCandidacy(id: string): Promise<ElectionDetail> {
    return firstValueFrom(this.http.post<ElectionDetail>(`${this.api}/elections/${id}/candidacy/open`, null));
  }
  closeCandidacy(id: string): Promise<ElectionDetail> {
    return firstValueFrom(this.http.post<ElectionDetail>(`${this.api}/elections/${id}/candidacy/close`, null));
  }
  /** 🔐 Administrateur d'institution seulement ; motif obligatoire (04 §4.6). */
  cancel(id: string, reason: string): Promise<ElectionDetail> {
    return firstValueFrom(this.http.post<ElectionDetail>(`${this.api}/elections/${id}/cancel`, { reason }));
  }
  /** Un nombre, jamais une liste (D-02). */
  eligibleCount(id: string): Promise<{ count: number }> {
    return firstValueFrom(this.http.get<{ count: number }>(`${this.api}/elections/${id}/eligible-count`));
  }

  staff(institutionId: string): Promise<StaffGrant[]> {
    return firstValueFrom(this.http.get<StaffGrant[]>(`${this.api}/institutions/${institutionId}/staff`));
  }
  /** 🔐 */
  addCommitteeMember(institutionId: string, electionId: string, email: string): Promise<unknown> {
    return firstValueFrom(this.http.post(`${this.api}/institutions/${institutionId}/roles`, { email, role: 'ELECTION_COMMITTEE', electionId }));
  }
  /** 🔐 */
  removeCommitteeMember(institutionId: string, assignmentId: string): Promise<void> {
    return firstValueFrom(this.http.post<void>(`${this.api}/institutions/${institutionId}/roles/${assignmentId}/revoke`, null));
  }
}
