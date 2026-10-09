import { Module } from '@nestjs/common';
import { RolesService } from './roles.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({ controllers: [UsersController], providers: [UsersService, RolesService] })
export class UsersModule {}
