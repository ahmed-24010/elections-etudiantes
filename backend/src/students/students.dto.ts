import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class DeclareEnrollmentDto {
  @Transform(trim) @IsString() @Matches(/^[A-Za-z0-9/_-]{3,64}$/, { message: 'numéro étudiant invalide' })
  studentNumber: string;

  @Transform(trim) @IsString() @MinLength(1) @MaxLength(100)
  firstName: string;

  @Transform(trim) @IsString() @MinLength(1) @MaxLength(100)
  lastName: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(255)
  fullNameAr?: string;

  @IsUUID()
  facultyId: string;

  @IsUUID()
  programId: string;

  @IsUUID()
  levelId: string;

  /** Facultatif : certaines filières n'ont pas de groupes (D-08). */
  @IsOptional() @IsUUID()
  groupId?: string;
}
