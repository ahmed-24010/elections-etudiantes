import { randomUUID } from 'crypto';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AuditInterceptor } from './common/authz/audit.interceptor';
import { AuthzModule } from './common/authz/authz.module';
import { JwtAuthGuard } from './common/authz/jwt-auth.guard';
import { PermissionGuard } from './common/authz/permission.guard';
import { StepUpGuard } from './common/authz/step-up.guard';
import { CandidatesModule } from './candidates/candidates.module';
import { validateEnv } from './config/env.validation';
import { ElectionsModule } from './elections/elections.module';
import { EligibilityModule } from './eligibility/eligibility.module';
import { HealthModule } from './health/health.module';
import { InstitutionsModule } from './institutions/institutions.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.service';
import { ReportsModule } from './reports/reports.module';
import { ResultsModule } from './results/results.module';
import { StudentsModule } from './students/students.module';
import { UsersModule } from './users/users.module';
import { VerificationModule } from './verification/verification.module';
import { VotingModule } from './voting/voting.module';

function hasModule(name: string): boolean {
  try {
    require.resolve(name);
    return true;
  } catch {
    return false;
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', 'info'),
          // Request ID : repris de l'en-tête s'il existe, sinon généré, et renvoyé au client.
          genReqId: (req, res) => {
            const id = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
            res.setHeader('x-request-id', id);
            return id;
          },
          // Ni jeton, ni cookie, ni corps de requête dans les logs (CLAUDE.md : jamais de choix de vote).
          redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
          serializers: {
            req: (req) => ({ id: req.id, method: req.method, url: req.url }),
            res: (res) => ({ statusCode: res.statusCode }),
          },
          // Lecture humaine en développement local ; pino-pretty est une devDependency, absente de l'image Docker.
          transport: config.get('NODE_ENV') === 'development' && hasModule('pino-pretty') ? { target: 'pino-pretty' } : undefined,
        },
      }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    AuthzModule,
    HealthModule,
    AuthModule,
    UsersModule,
    StudentsModule,
    InstitutionsModule,
    VerificationModule,
    ElectionsModule,
    EligibilityModule,
    CandidatesModule,
    VotingModule,
    ResultsModule,
    ReportsModule,
    AuditModule,
    NotificationsModule,
  ],
  // L'ORDRE COMPTE : débit → authentification → permission + portée → 2FA récente. Refus par défaut.
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_GUARD, useClass: StepUpGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
