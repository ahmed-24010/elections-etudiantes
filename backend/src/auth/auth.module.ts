import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginAttemptLimiter } from './login-attempt.limiter';
import { TwoFactorService } from './two-factor.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, TwoFactorService, LoginAttemptLimiter],
  exports: [AuthService, LoginAttemptLimiter], // le limiteur est partagé : un échec de mot de passe au vote compte comme à la connexion (D-30)
})
export class AuthModule {}
