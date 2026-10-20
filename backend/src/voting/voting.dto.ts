import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsNotEmpty, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class ChoiceDto {
  @IsString() @IsNotEmpty() @MaxLength(64)
  positionId: string;

  /** Vide = vote blanc pour ce poste. Le contenu est contrôlé par le service (422 INVALID_BALLOT), pas ici. */
  @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(64, { each: true })
  candidateIds: string[];
}

/** Corps de POST /voting/:id/ballot. Il n'est JAMAIS journalisé (CLAUDE.md, règle 5). */
export class CastBallotDto {
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ChoiceDto)
  choices: ChoiceDto[];

  /** Mot de passe ressaisi à la confirmation (D-30). */
  @IsString() @IsNotEmpty() @MaxLength(200)
  password: string;
}

export class CloseVotingDto {
  /** Motif obligatoire d'une clôture manuelle anticipée (04 §4.4). */
  @IsString() @MinLength(3) @MaxLength(500)
  reason: string;
}

/** Corps de POST /elections/:id/voting/extend (D-33, D-38) : le comité déclare la panne, puis la nouvelle fin. */
export class ExtendVotingDto {
  @IsDateString({ strict: true }) @MaxLength(40)
  outageStartedAt: string;

  @IsDateString({ strict: true }) @MaxLength(40)
  outageEndedAt: string;

  @IsDateString({ strict: true }) @MaxLength(40)
  newEndsAt: string;

  /** Motif obligatoire, écrit dans `audit_logs`. */
  @IsString() @MinLength(3) @MaxLength(500)
  reason: string;
}

/** Corps de POST /elections/:id/voter-roll/preview : le matricule seul (D-39). */
export class VoterLookupDto {
  @IsString() @IsNotEmpty() @MaxLength(64)
  studentNumber: string;
}

/** Corps de POST /elections/:id/voter-roll : ajout exceptionnel après le gel (04 §5.2, D-39). */
export class AddVoterDto extends VoterLookupDto {
  @IsString() @MinLength(3) @MaxLength(500)
  reason: string;
}
