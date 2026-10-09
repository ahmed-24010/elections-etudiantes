import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { RequestInfo } from '../auth/auth.service';
import type { AuthUser } from '../common/authz/auth-user';
import { CurrentUser, RequirePermission, ScopeFrom } from '../common/authz/decorators';
import { AssignRoleDto, ChangePasswordDto } from './dto/users.dto';
import { RolesService } from './roles.service';
import { UsersService } from './users.service';

const info = (req: Request): RequestInfo => ({
  ip: req.ip,
  userAgent: req.headers['user-agent'],
  requestId: String((req as { id?: unknown }).id ?? ''),
});

@ApiTags('users')
@Controller()
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly roles: RolesService,
  ) {}

  @Get('users/me')
  @RequirePermission('user:update:self')
  me(@CurrentUser() user: AuthUser) {
    return this.users.getMe(user);
  }

  @Patch('users/me/password')
  @HttpCode(204)
  @RequirePermission('user:update:self')
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto, @Req() req: Request) {
    return this.users.changePassword(user, dto.currentPassword, dto.newPassword, info(req));
  }

  /** 🔐 La portée vient des rattachements du compte ciblé, lus en base. */
  @Post('users/:id/suspend')
  @HttpCode(204)
  @RequirePermission('user:suspend')
  @ScopeFrom('user', 'id')
  suspend(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.users.suspend(user, id, info(req));
  }

  @Get('institutions/:institutionId/staff')
  @RequirePermission('user:read')
  @ScopeFrom('institution', 'institutionId')
  staff(@Param('institutionId') institutionId: string) {
    return this.roles.listStaff(institutionId);
  }

  /** 🔐 Le guard accepte l'une des trois permissions ; RolesService vérifie celle du rôle demandé. */
  @Post('institutions/:institutionId/roles')
  @RequirePermission('role:assign:INSTITUTION_ADMIN', 'role:assign:VERIFICATION_OFFICER', 'role:assign:ELECTION_COMMITTEE')
  @ScopeFrom('institution', 'institutionId')
  assign(@CurrentUser() user: AuthUser, @Param('institutionId') institutionId: string, @Body() dto: AssignRoleDto, @Req() req: Request) {
    return this.roles.assign(user, institutionId, dto, info(req));
  }

  @Post('institutions/:institutionId/roles/:assignmentId/revoke')
  @HttpCode(204)
  @RequirePermission('role:revoke')
  @ScopeFrom('institution', 'institutionId')
  revoke(
    @CurrentUser() user: AuthUser,
    @Param('institutionId') institutionId: string,
    @Param('assignmentId') assignmentId: string,
    @Req() req: Request,
  ) {
    return this.roles.revoke(user, institutionId, assignmentId, info(req));
  }
}
