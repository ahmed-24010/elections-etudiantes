import { RejectionCode } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

export class RejectEnrollmentDto {
  /** WRONG_STUDENT_NUMBER libère le numéro étudiant (D-22). */
  @IsEnum(RejectionCode)
  code: RejectionCode;

  /** Motif lisible par l'étudiant : obligatoire (02 §4.3). */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @MinLength(3) @MaxLength(500)
  reason: string;
}
