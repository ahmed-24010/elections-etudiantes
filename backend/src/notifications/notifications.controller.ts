import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../common/authz/auth-user';
import { CurrentUser, RequirePermission } from '../common/authz/decorators';
import { NotificationsService } from './notifications.service';

/** Mes notifications dans l'application (validation, rejet). Chaque utilisateur ne voit que les siennes. */
@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @RequirePermission('user:update:self')
  list(@CurrentUser() user: AuthUser) {
    return this.notifications.list(user.id);
  }

  @Post('read-all')
  @HttpCode(204)
  @RequirePermission('user:update:self')
  readAll(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.id);
  }

  @Post(':id/read')
  @HttpCode(204)
  @RequirePermission('user:update:self')
  read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.markRead(user.id, id);
  }
}
