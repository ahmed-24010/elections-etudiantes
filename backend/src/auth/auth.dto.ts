import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Length, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty() @IsString() @MinLength(8) password: string;
  @ApiPropertyOptional({ description: 'Code TOTP à 6 chiffres (obligatoire si 2FA activée)' })
  @IsOptional() @IsString() @Length(6, 6) totp?: string;
}

export class RefreshDto {
  @ApiProperty() @IsString() @IsNotEmpty() refreshToken: string;
}

export class TotpDto {
  @ApiProperty() @IsString() @Length(6, 6) code: string;
}

export class TokensDto {
  accessToken: string;
  refreshToken: string;
}
