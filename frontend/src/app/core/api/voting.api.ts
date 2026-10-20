import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

/** Où en est l'étudiant (jamais ce qu'il a voté). */
export type VoterState = 'NOT_ON_ROLL' | 'NOT_VOTED' | 'VOTED';

export interface VotingStatus {
  state: VoterState;
  electionStatus: string;
  /** Vote ouvert maintenant (état et fenêtre horaire de la base de données). */
  open: boolean;
  votingStartsAt: string;
  votingEndsAt: string;
  votedAt: string | null;
}

export interface BallotCandidate {
  id: string;
  firstName: string;
  lastName: string;
  fullNameAr: string | null;
  statement: string | null;
  hasPhoto: boolean;
  hasProgram: boolean;
}

export interface BallotPosition {
  id: string;
  title: string;
  titleAr: string | null;
  maxChoices: number;
  allowBlank: boolean;
  /** Dans l'ordre tiré au hasard par le serveur pour cet électeur (D-35) : ne jamais le retrier. */
  candidates: BallotCandidate[];
}

export interface Ballot {
  electionId: string;
  title: string;
  titleAr: string | null;
  votingEndsAt: string;
  positions: BallotPosition[];
}

/** `candidateIds` vide = vote blanc pour ce poste. */
export interface BallotChoice {
  positionId: string;
  candidateIds: string[];
}

/** Suivi du comité : des chiffres seulement (D-02). Sous 50 électeurs, `voted` est arrêté à `asOf` (tranches de 15 min, D-31). */
export interface Turnout {
  registered: number;
  voted: number;
  rate: number;
  asOf: string;
  sliced: boolean;
  status: string;
  votingStartsAt: string;
  votingEndsAt: string;
  /** Le vote a déjà été prolongé : on ne peut le faire qu'une fois (D-33). */
  extended: boolean;
  addedAfterFreeze: number;
}

export interface ExtendBody {
  outageStartedAt: string;
  outageEndedAt: string;
  newEndsAt: string;
  reason: string;
}

/** Ce que la confirmation d'un ajout montre : jamais le nom (D-39). */
export interface VoterPreview {
  faculty: { name: string; nameAr: string | null };
  program: { name: string; nameAr: string | null };
  level: { name: string; nameAr: string | null };
  group: string | null;
}

/** Vote secret (04 §6). Le corps de `cast` contient le mot de passe et les choix : il n'est jamais journalisé ni conservé. */
@Injectable({ providedIn: 'root' })
export class VotingApi {
  private readonly http = inject(HttpClient);
  private readonly api = environment.apiUrl;

  status(electionId: string): Promise<VotingStatus> {
    return firstValueFrom(this.http.get<VotingStatus>(`${this.api}/voting/${electionId}/status`));
  }
  ballot(electionId: string): Promise<Ballot> {
    return firstValueFrom(this.http.get<Ballot>(`${this.api}/voting/${electionId}/ballot`));
  }
  cast(electionId: string, choices: BallotChoice[], password: string): Promise<{ status: 'recorded' }> {
    return firstValueFrom(this.http.post<{ status: 'recorded' }>(`${this.api}/voting/${electionId}/ballot`, { choices, password }));
  }
  turnout(electionId: string): Promise<Turnout> {
    return firstValueFrom(this.http.get<Turnout>(`${this.api}/elections/${electionId}/turnout`));
  }
  /** 🔐 À appeler via StepUpService.run. */
  openVoting(electionId: string): Promise<{ status: string }> {
    return firstValueFrom(this.http.post<{ status: string }>(`${this.api}/elections/${electionId}/voting/open`, {}));
  }
  /** 🔐 Motif obligatoire. */
  closeVoting(electionId: string, reason: string): Promise<{ status: string }> {
    return firstValueFrom(this.http.post<{ status: string }>(`${this.api}/elections/${electionId}/voting/close`, { reason }));
  }
  /** 🔐 Une seule fois (D-33, D-38). */
  extendVoting(electionId: string, body: ExtendBody): Promise<{ votingEndsAt: string }> {
    return firstValueFrom(this.http.post<{ votingEndsAt: string }>(`${this.api}/elections/${electionId}/voting/extend`, body));
  }
  /** 🔐 N'écrit rien. */
  previewVoter(electionId: string, studentNumber: string): Promise<VoterPreview> {
    return firstValueFrom(this.http.post<VoterPreview>(`${this.api}/elections/${electionId}/voter-roll/preview`, { studentNumber }));
  }
  /** 🔐 Ajout exceptionnel (04 §5.2, D-39). */
  addVoter(electionId: string, studentNumber: string, reason: string): Promise<{ registered: number }> {
    return firstValueFrom(this.http.post<{ registered: number }>(`${this.api}/elections/${electionId}/voter-roll`, { studentNumber, reason }));
  }
}
