import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CandidateStatus } from './elections.api';

export type FileKind = 'photo' | 'program';

/** Ma candidature (l'étudiant lit son motif de rejet). */
export interface OwnCandidacy {
  id: string;
  positionId: string;
  status: CandidateStatus;
  statement: string | null;
  rejectionReason: string | null;
  hasPhoto: boolean;
  hasProgram: boolean;
}

/** Candidat validé : liste publique. Ni statut ni identifiant d'étudiant. */
export interface PublicCandidate {
  id: string;
  positionId: string;
  statement: string | null;
  hasPhoto: boolean;
  hasProgram: boolean;
  firstName: string;
  lastName: string;
  fullNameAr: string | null;
}

/** Vue du comité : tout, motifs compris, jamais de numéro étudiant. */
export interface ReviewCandidate extends OwnCandidacy {
  reviewedAt: string | null;
  firstName: string;
  lastName: string;
  fullNameAr: string | null;
  enrollment: { programId: string; levelId: string; groupId: string | null } | null;
}

/** Candidatures (03 §5.5). Valider / rejeter sont des actions 🔐 : à appeler via StepUpService.run. */
@Injectable({ providedIn: 'root' })
export class CandidatesApi {
  private readonly http = inject(HttpClient);
  private readonly api = environment.apiUrl;
  private base(electionId: string): string {
    return `${this.api}/elections/${electionId}/candidates`;
  }

  apply(electionId: string, body: { positionId: string; statement?: string }): Promise<OwnCandidacy> {
    return firstValueFrom(this.http.post<OwnCandidacy>(this.base(electionId), body));
  }
  mine(electionId: string): Promise<OwnCandidacy> {
    return firstValueFrom(this.http.get<OwnCandidacy>(`${this.base(electionId)}/me`));
  }
  update(electionId: string, body: { positionId?: string; statement?: string }): Promise<OwnCandidacy> {
    return firstValueFrom(this.http.patch<OwnCandidacy>(`${this.base(electionId)}/me`, body));
  }
  withdraw(electionId: string): Promise<OwnCandidacy> {
    return firstValueFrom(this.http.post<OwnCandidacy>(`${this.base(electionId)}/me/withdraw`, null));
  }
  resubmit(electionId: string): Promise<OwnCandidacy> {
    return firstValueFrom(this.http.post<OwnCandidacy>(`${this.base(electionId)}/me/resubmit`, null));
  }
  upload(electionId: string, kind: FileKind, file: File): Promise<OwnCandidacy> {
    const form = new FormData();
    form.append('file', file, file.name);
    return firstValueFrom(this.http.post<OwnCandidacy>(`${this.base(electionId)}/me/files/${kind}`, form));
  }
  listApproved(electionId: string): Promise<PublicCandidate[]> {
    return firstValueFrom(this.http.get<PublicCandidate[]>(this.base(electionId)));
  }
  listAll(electionId: string): Promise<ReviewCandidate[]> {
    return firstValueFrom(this.http.get<ReviewCandidate[]>(`${this.base(electionId)}/all`));
  }
  approve(electionId: string, candidateId: string): Promise<unknown> {
    return firstValueFrom(this.http.post(`${this.base(electionId)}/${candidateId}/approve`, null));
  }
  reject(electionId: string, candidateId: string, reason: string): Promise<unknown> {
    return firstValueFrom(this.http.post(`${this.base(electionId)}/${candidateId}/reject`, { reason }));
  }

  /** URL signée de 5 minutes, puis téléchargement dans le navigateur (jamais affiché depuis l'origine de l'API). */
  async openFile(electionId: string, candidateId: string, kind: FileKind): Promise<Blob> {
    const access = await firstValueFrom(this.http.post<{ url: string }>(`${this.base(electionId)}/${candidateId}/files/${kind}/access`, null));
    return firstValueFrom(this.http.get(access.url, { responseType: 'blob' }));
  }
}
