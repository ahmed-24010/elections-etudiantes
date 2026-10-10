import { OmitType, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const CODE = /^[A-Za-z0-9_-]+$/;

export class FacultyDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(32) @Matches(CODE, { message: 'code : lettres, chiffres, - et _ seulement' })
  code: string;

  @Transform(trim) @IsString() @MinLength(1) @MaxLength(255)
  name: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(255)
  nameAr?: string;
}
export class UpdateFacultyDto extends PartialType(FacultyDto) {}

export class ProgramDto {
  @IsUUID()
  facultyId: string;

  @Transform(trim) @IsString() @MinLength(1) @MaxLength(32) @Matches(CODE)
  code: string;

  @Transform(trim) @IsString() @MinLength(1) @MaxLength(255)
  name: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(255)
  nameAr?: string;
}
// Une filière ne change pas de faculté : ses inscriptions et ses groupes en dépendent.
export class UpdateProgramDto extends PartialType(OmitType(ProgramDto, ['facultyId'] as const)) {}

export class LevelDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(16) @Matches(CODE)
  code: string;

  @Transform(trim) @IsString() @MinLength(1) @MaxLength(100)
  name: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(100)
  nameAr?: string;

  @IsInt() @Min(0) @Max(100)
  rank: number;
}
export class UpdateLevelDto extends PartialType(LevelDto) {}

export class AcademicYearDto {
  @Matches(/^\d{4}-\d{4}$/, { message: 'libellé attendu : AAAA-AAAA' })
  label: string;

  @IsDateString({ strict: true })
  startsOn: string;

  @IsDateString({ strict: true })
  endsOn: string;
}
export class UpdateAcademicYearDto extends PartialType(AcademicYearDto) {}

export class GroupDto {
  @IsUUID()
  programId: string;

  @IsUUID()
  levelId: string;

  @IsUUID()
  academicYearId: string;

  @Transform(trim) @IsString() @MinLength(1) @MaxLength(32)
  name: string;
}
// Seul le nom d'un groupe peut changer (filière, niveau et année le définissent).
export class UpdateGroupDto extends PartialType(OmitType(GroupDto, ['programId', 'levelId', 'academicYearId'] as const)) {}
