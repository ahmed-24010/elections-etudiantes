import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ApplyDto {
  @IsUUID()
  positionId: string;

  /** Programme électoral (texte). La photo et le programme en PDF se déposent ensuite, séparément. */
  @IsOptional() @Transform(trim) @IsString() @MaxLength(5000)
  statement?: string;
}

/** Avant validation seulement (03 §5.5 : `candidate:update`). */
export class UpdateCandidacyDto {
  @IsOptional() @IsUUID()
  positionId?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(5000)
  statement?: string;
}

export class RejectDto {
  /** Motif obligatoire : le candidat le lira. */
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(500)
  reason: string;
}
