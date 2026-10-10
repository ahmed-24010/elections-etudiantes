import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

export interface AppSetupOptions {
  /** Nombre de proxys de confiance devant l'API (1 derrière nginx). 0 = lire l'IP de la connexion. */
  trustProxy: number;
  corsOrigin?: string;
}

/** Configuration HTTP commune à main.ts et aux tests e2e, pour que les tests exercent la vraie configuration. */
export function configureApp(app: NestExpressApplication, opts: AppSetupOptions): void {
  // Derrière nginx, sans cela le rate limiting verrait l'IP du proxy pour tous les clients.
  app.set('trust proxy', opts.trustProxy);
  app.use(helmet());
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: opts.corsOrigin?.split(',') ?? false, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
}
