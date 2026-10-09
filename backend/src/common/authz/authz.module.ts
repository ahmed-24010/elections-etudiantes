import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConflictPolicy } from './conflict.policy';
import { AuthzService } from './authz.service';
import { ScopeResolver } from './scope-resolver.service';

/** Services d'autorisation partagés. Les guards globaux sont enregistrés dans AppModule, dans l'ordre. */
@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [AuthzService, ScopeResolver, ConflictPolicy],
  exports: [AuthzService, ScopeResolver, ConflictPolicy, JwtModule],
})
export class AuthzModule {}
