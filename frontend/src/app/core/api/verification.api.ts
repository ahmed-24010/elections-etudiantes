import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DocumentStatus, EnrollmentStatus, RejectionCode } from './enrollment.api';

interface Label {
  code?: string;
  name: string;
  nameAr?: string | null;
}

export interface ReviewItem {
  id: string;
  status: EnrollmentStatus;
  submittedAt: string;
  student: { studentNumber: string | null; firstName: string; lastName: string; fullNameAr: string | null };
  faculty: Label;
  program: Label;
  level: Label;
  group: { name: string } | null;
  academicYear: { label: string };
  document: { id: string; status: DocumentStatus; mimeType: string; sizeBytes: number } | null;
}
export interface ReviewDetail extends ReviewItem {
  /** Vrai si le vérificateur est l'étudiant ou le déposant : le serveur refusera (03 §6). */
  ownRequest: boolean;
}

/** File du vérificateur. Valider et rejeter sont des actions 🔐 : à appeler via StepUpService.run. */
@Injectable({ providedIn: 'root' })
export class VerificationApi {
  private readonly http = inject(HttpClient);
  private readonly api = environment.apiUrl;

  queue(institutionId: string): Promise<ReviewItem[]> {
    return firstValueFrom(this.http.get<ReviewItem[]>(`${this.api}/institutions/${institutionId}/verification/queue`));
  }
  detail(id: string): Promise<ReviewDetail> {
    return firstValueFrom(this.http.get<ReviewDetail>(`${this.api}/enrollments/${id}/review`));
  }
  approve(id: string): Promise<void> {
    return firstValueFrom(this.http.post<void>(`${this.api}/enrollments/${id}/approve`, null));
  }
  reject(id: string, code: RejectionCode, reason: string): Promise<void> {
    return firstValueFrom(this.http.post<void>(`${this.api}/enrollments/${id}/reject`, { code, reason }));
  }

  /** Demande une URL signée (5 min) puis télécharge l'attestation dans le navigateur (jamais affichée depuis l'origine de l'API). */
  async openDocument(id: string): Promise<Blob> {
    const access = await firstValueFrom(this.http.post<{ url: string; expiresAt: string }>(`${this.api}/enrollments/${id}/document-access`, null));
    return firstValueFrom(this.http.get(access.url, { responseType: 'blob' }));
  }
}
