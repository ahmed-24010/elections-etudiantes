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
}
