import { Transform } from 'class-transformer';
import { Role } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MAX, PASSWORD_MIN } from '../../auth/dto/auth.dto';

export class ChangePasswordDto {
  @IsString() @MaxLength(PASSWORD_MAX)
  currentPassword: string;

  @IsString() @MinLength(PASSWORD_MIN) @MaxLength(PASSWORD_MAX)
  newPassword: string;
}

export class AssignRoleDto {
  /** Compte existant du destinataire (il s'est inscrit comme étudiant). */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)) @IsEmail()
  email: string;

  @IsEnum(Role)
  role: Role;

  /** Obligatoire pour ELECTION_COMMITTEE ; l'élection est relue en base et doit appartenir à l'institution. */
  @IsOptional() @IsUUID()
  electionId?: string;
}
