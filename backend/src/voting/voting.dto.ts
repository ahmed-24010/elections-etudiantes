import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsNotEmpty, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

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
