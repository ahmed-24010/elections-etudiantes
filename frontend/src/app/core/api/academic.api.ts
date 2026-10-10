import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface Named {
  id: string;
  code?: string;
  name: string;
  nameAr?: string | null;
}
export interface Faculty extends Named {
  code: string;
}
export interface Program extends Named {
  code: string;
  facultyId: string;
}
export interface Level extends Named {
  code: string;
  rank: number;
}
export interface AcademicYear {
  id: string;
  label: string;
  startsOn: string;
  endsOn: string;
  isCurrent: boolean;
}
export interface Group {
  id: string;
  name: string;
  programId: string;
  levelId: string;
  academicYearId: string;
}
export interface AcademicOverview {
  years: AcademicYear[];
  faculties: Faculty[];
  programs: Program[];
  levels: Level[];
  groups: Group[];
}

export type AcademicKind = 'faculties' | 'programs' | 'levels' | 'years' | 'groups';

/** Nom à afficher selon la langue : le nom arabe s'il existe, sinon le nom principal. */
export function localName(item: { name: string; nameAr?: string | null }, lang: 'ar' | 'fr'): string {
  return lang === 'ar' && item.nameAr ? item.nameAr : item.name;
}

/** Structure académique d'une institution (routes `academic:read` / `academic:manage`). */
@Injectable({ providedIn: 'root' })
export class AcademicApi {
  private readonly http = inject(HttpClient);
  private base(institutionId: string): string {
    return `${environment.apiUrl}/institutions/${institutionId}/academic`;
  }

  overview(institutionId: string): Promise<AcademicOverview> {
    return firstValueFrom(this.http.get<AcademicOverview>(this.base(institutionId)));
  }
  create(institutionId: string, kind: AcademicKind, body: Record<string, unknown>): Promise<unknown> {
    return firstValueFrom(this.http.post(`${this.base(institutionId)}/${kind}`, body));
  }
  update(institutionId: string, kind: AcademicKind, id: string, body: Record<string, unknown>): Promise<unknown> {
    return firstValueFrom(this.http.patch(`${this.base(institutionId)}/${kind}/${id}`, body));
  }
  remove(institutionId: string, kind: AcademicKind, id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base(institutionId)}/${kind}/${id}`));
  }
  setCurrentYear(institutionId: string, id: string): Promise<unknown> {
    return firstValueFrom(this.http.post(`${this.base(institutionId)}/years/${id}/current`, null));
  }
}
