import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission, ScopeFrom } from '../common/authz/decorators';
import { DashboardService } from './dashboard.service';

/** Tableau de bord de l'administrateur d'institution (03 §5.4, D-48) : des chiffres, jamais de liste nominative. */
@ApiTags('dashboard')
@Controller()
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('institutions/:institutionId/dashboard')
  @RequirePermission('dashboard:read')
  @ScopeFrom('institution', 'institutionId')
  get(@Param('institutionId') institutionId: string) {
    return this.dashboard.get(institutionId);
  }
}
