import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

export type ReportLang = 'fr' | 'ar';

/** Un rapport = un PV par langue (D-42) : même identifiant et même code, un SHA-256 par langue. */
export interface ReportSummary {
  reportId: string;
  verificationCode: string;
  generatedAt: string;
  ballotsDigest: string;
  sha256: Record<ReportLang, string>;
  revoked: boolean;
  /** « PV signé » (D-47) : date à laquelle le comité a attesté la signature de l'exemplaire imprimé. */
  signedAt: string | null;
}

/** Procès-verbal : lecture par le personnel (`report:read`), régénération 🔐 (`report:generate`). */
@Injectable({ providedIn: 'root' })
export class ReportsApi {
  private readonly http = inject(HttpClient);
  private readonly api = environment.apiUrl;

  list(electionId: string): Promise<ReportSummary[]> {
    return firstValueFrom(this.http.get<ReportSummary[]>(`${this.api}/elections/${electionId}/reports`));
  }
  /** 🔐 À appeler via StepUpService.run. Crée un nouveau rapport (les deux langues). */
  generate(electionId: string): Promise<ReportSummary> {
    return firstValueFrom(this.http.post<ReportSummary>(`${this.api}/elections/${electionId}/report`, {}));
  }
  /** 🔐 Comité seulement (D-47). */
  markSigned(electionId: string): Promise<{ reportId: string; signedAt: string }> {
    return firstValueFrom(this.http.post<{ reportId: string; signedAt: string }>(`${this.api}/elections/${electionId}/report/signed`, {}));
  }
  /** Le PV non révoqué le plus récent dans la langue demandée : celle du site (D-42). */
  download(electionId: string, lang: ReportLang): Promise<Blob> {
    return firstValueFrom(this.http.get(`${this.api}/elections/${electionId}/report/download`, { params: { lang }, responseType: 'blob' }));
  }
}
