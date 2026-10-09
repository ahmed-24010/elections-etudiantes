import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthUser, CurrentUser, Roles } from '../common/roles';

@ApiTags('me')
@ApiBearerAuth()
@Controller()
export class MeController {
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  /** Exemple de route protégée par RBAC (sera remplacée par le vrai module d'administration). */
  @Roles(Role.SUPER_ADMIN, Role.INSTITUTION_ADMIN)
  @Get('admin/ping')
  adminPing() {
    return { ok: true };
  }
}
