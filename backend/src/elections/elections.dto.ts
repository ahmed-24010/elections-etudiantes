import { OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateElectionDto {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(255)
  title: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(255)
  titleAr?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(5000)
  description?: string;

  /** Année universitaire de l'élection : relue en base, elle doit appartenir à l'institution. */
  @IsUUID()
  academicYearId: string;

  @IsOptional() @IsDateString({ strict: true })
  candidacyStartsAt?: string;

  @IsOptional() @IsDateString({ strict: true })
  candidacyEndsAt?: string;

  @IsDateString({ strict: true })
  votingStartsAt: string;

  @IsDateString({ strict: true })
  votingEndsAt: string;
}

// L'année universitaire ne change pas : règles et inscriptions en dépendent.
export class UpdateElectionDto extends PartialType(OmitType(CreateElectionDto, ['academicYearId'] as const)) {}

export class RuleDto {
  @IsOptional() @IsUUID()
  facultyId?: string;

  @IsOptional() @IsUUID()
  programId?: string;

  @IsOptional() @IsUUID()
  levelId?: string;

  @IsOptional() @IsUUID()
  groupId?: string;
}

/**
 * Remplace toutes les règles d'éligibilité. Chaque règle porte au moins un critère. « Toute l'institution » est un
 * choix EXPLICITE (`wholeInstitution`), jamais déduit d'une liste vide : aucune règle = personne n'est éligible.
 */
export class SetRulesDto {
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => RuleDto)
  rules: RuleDto[];

  @IsOptional() @IsBoolean()
  wholeInstitution?: boolean;
}

export class PositionDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(191)
  title: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(191)
  titleAr?: string;

  @IsOptional() @IsInt() @Min(1) @Max(50)
  seats?: number;

  @IsOptional() @IsInt() @Min(1) @Max(50)
  maxChoices?: number;

  @IsOptional() @IsBoolean()
  allowBlank?: boolean;

  @IsOptional() @IsInt() @Min(0) @Max(1000)
  displayOrder?: number;
}
export class UpdatePositionDto extends PartialType(PositionDto) {}
