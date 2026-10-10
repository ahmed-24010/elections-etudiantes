import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

export type EnrollmentStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';
export type DocumentStatus = 'UPLOADED' | 'APPROVED' | 'REJECTED';
export type RejectionCode = 'WRONG_STUDENT_NUMBER' | 'DOCUMENT_UNREADABLE' | 'DATA_MISMATCH' | 'OTHER';
export const REJECTION_CODES: readonly RejectionCode[] = ['WRONG_STUDENT_NUMBER', 'DOCUMENT_UNREADABLE', 'DATA_MISMATCH', 'OTHER'];

/** Attestation : 5 Mo maximum, PDF / JPEG / PNG (D-23). Le serveur vérifie le vrai type ; ceci n'est qu'un confort. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_TYPES = 'application/pdf,image/jpeg,image/png';

interface Label {
  id?: string;
  code?: string;
  name: string;
  nameAr?: string | null;
}

export interface StudentMe {
  institutionId: string;
  currentYear: { id: string; label: string } | null;
  student: { id: string; studentNumber: string | null; firstName: string; lastName: string; fullNameAr: string | null } | null;
  enrollment: {
    id: string;
    status: EnrollmentStatus;
    rejectionCode: RejectionCode | null;
    rejectionReason: string | null;
    faculty: Label;
    program: Label;
    level: Label;
    group: { id: string; name: string } | null;
    academicYear: { id: string; label: string };
  } | null;
  document: { id: string; status: DocumentStatus; createdAt: string; mimeType: string; sizeBytes: number } | null;
  canEdit: boolean;
  canUpload: boolean;
}

export interface DeclareEnrollment {
  studentNumber: string;
  firstName: string;
  lastName: string;
  fullNameAr?: string;
  facultyId: string;
  programId: string;
  levelId: string;
  groupId?: string;
}

export interface AppNotification {
  id: string;
  type: 'ENROLLMENT_VERIFIED' | 'ENROLLMENT_REJECTED';
  body: string;
  readAt: string | null;
  createdAt: string;
}

/** Espace de l'étudiant : profil, inscription de l'année courante, attestation, notifications. */
@Injectable({ providedIn: 'root' })
export class EnrollmentApi {
  private readonly http = inject(HttpClient);
  private readonly api = environment.apiUrl;

  me(): Promise<StudentMe> {
    return firstValueFrom(this.http.get<StudentMe>(`${this.api}/students/me`));
  }
  declare(body: DeclareEnrollment): Promise<StudentMe> {
    return firstValueFrom(this.http.put<StudentMe>(`${this.api}/students/me/enrollment`, body));
  }
  upload(file: File): Promise<unknown> {
    const form = new FormData();
    form.append('file', file, file.name);
    return firstValueFrom(this.http.post(`${this.api}/students/me/enrollment/document`, form));
  }
  notifications(): Promise<{ unread: number; items: AppNotification[] }> {
    return firstValueFrom(this.http.get<{ unread: number; items: AppNotification[] }>(`${this.api}/notifications`));
  }
  readAll(): Promise<void> {
    return firstValueFrom(this.http.post<void>(`${this.api}/notifications/read-all`, null));
  }
}
