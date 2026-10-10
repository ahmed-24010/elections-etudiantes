import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export const PASSWORD_MIN = 10;
// Plafond contre le déni de service par hachage Argon2 de très longues chaînes.
export const PASSWORD_MAX = 128;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class RegisterDto {
  @IsOptional() @Transform(trim) @IsEmail() @MaxLength(191)
  email?: string;

  @IsOptional() @Transform(trim) @Matches(/^\+?[0-9 .-]{8,20}$/, { message: 'phone invalide' })
  phone?: string;

  @IsString() @MinLength(PASSWORD_MIN) @MaxLength(PASSWORD_MAX)
  password: string;

  /** Code de l'institution, tel que renvoyé par GET /institutions/public. */
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(32)
  institutionCode: string;
}

export class LoginDto {
  /** E-mail ou téléphone. */
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(191)
  identifier: string;

  @IsString() @IsNotEmpty() @MaxLength(PASSWORD_MAX)
  password: string;

  @IsOptional() @Matches(/^\d{6}$/)
  totp?: string;
}

export class CodeDto {
  @Matches(/^\d{6}$/, { message: 'code à 6 chiffres attendu' })
  code: string;
}
