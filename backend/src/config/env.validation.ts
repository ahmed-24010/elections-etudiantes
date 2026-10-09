import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MinLength, validateSync } from 'class-validator';

export class EnvironmentVariables {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: string = 'development';

  @IsInt()
  PORT: number = 3000;

  @IsString() @IsNotEmpty()
  DATABASE_URL: string;

  @IsString() @MinLength(32)
  JWT_ACCESS_SECRET: string;

  @IsString() @MinLength(32)
  JWT_REFRESH_SECRET: string;

  @IsString()
  JWT_ACCESS_TTL: string = '15m';

  @IsInt()
  REFRESH_TTL_DAYS: number = 7;

  // Clé AES-256-GCM (32 octets en base64) du secret 2FA, jamais en base. Générer :
  // node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  @IsString() @Matches(/^[A-Za-z0-9+/]{43}=$/, { message: 'doit être 32 octets encodés en base64' })
  TWO_FACTOR_ENCRYPTION_KEY: string;

  // Sel secret du hash d'IP dans audit_logs (02 §10).
  @IsString() @MinLength(16)
  AUDIT_IP_SALT: string;

  @IsString()
  TWO_FACTOR_ISSUER: string = 'Elections Etudiantes';

  @IsOptional() @IsString()
  CORS_ORIGIN?: string;

  // Nombre de proxys de confiance devant l'API (1 derrière nginx). 0 = lire l'IP de la connexion.
  @IsInt()
  TRUST_PROXY: number = 0;

  @IsIn(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
  LOG_LEVEL: string = 'info';

  @IsOptional() @IsString() S3_ENDPOINT?: string;
  @IsOptional() @IsString() S3_REGION?: string;
  @IsOptional() @IsString() S3_BUCKET?: string;
  @IsOptional() @IsString() S3_ACCESS_KEY?: string;
  @IsOptional() @IsString() S3_SECRET_KEY?: string;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: true });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const details = errors.map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`);
    throw new Error(`Configuration invalide :\n${details.join('\n')}`);
  }
  return validated;
}
