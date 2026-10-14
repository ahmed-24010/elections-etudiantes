import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthUser } from '../common/authz/auth-user';
import { CurrentUser, RequirePermission, ScopeFrom } from '../common/authz/decorators';
import { requestInfo } from '../common/http/request-info';
import { CreateElectionDto, PositionDto, SetRulesDto, UpdateElectionDto, UpdatePositionDto } from './elections.dto';
import { ElectionsService } from './elections.service';

/**
 * Élections (03 §5.4). La portée (institution, élection) est relue en base par le guard ; les règles « qui voit quoi »
 * (brouillon invisible à l'étudiant, éligibilité) sont appliquées par le service.
 */
@ApiTags('elections')
@Controller()
export class ElectionsController {
  constructor(private readonly elections: ElectionsService) {}

  @Post('institutions/:institutionId/elections')
  @RequirePermission('election:create')
  @ScopeFrom('institution', 'institutionId')
  create(@CurrentUser() u: AuthUser, @Param('institutionId') institutionId: string, @Body() dto: CreateElectionDto, @Req() req: Request) {
    return this.elections.create(u, institutionId, dto, requestInfo(req));
  }

  /** Liste de gestion : toutes les élections pour l'IA, les siennes pour un membre du comité. */
  @Get('institutions/:institutionId/elections')
  @RequirePermission('election:update')
  @ScopeFrom('institution', 'institutionId')
  list(@CurrentUser() u: AuthUser, @Param('institutionId') institutionId: string) {
    return this.elections.listForStaff(u, institutionId);
  }

  /** « Mes élections » : celles qui concernent l'étudiant (éligible, à partir de CANDIDACY_OPEN). Déclarée avant `:id`. */
  @Get('elections/mine')
  @RequirePermission('election:list:mine')
  mine(@CurrentUser() u: AuthUser) {
    return this.elections.mine(u);
  }

  @Get('elections/:id')
  @RequirePermission('election:read')
  @ScopeFrom('election', 'id')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.elections.get(u, id);
  }

  @Patch('elections/:id')
  @RequirePermission('election:update')
  @ScopeFrom('election', 'id')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateElectionDto, @Req() req: Request) {
    return this.elections.update(u, id, dto, requestInfo(req));
  }

  @Put('elections/:id/rules')
  @RequirePermission('election:rules:manage')
  @ScopeFrom('election', 'id')
  setRules(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: SetRulesDto, @Req() req: Request) {
    return this.elections.setRules(u, id, dto, requestInfo(req));
  }

  @Post('elections/:id/positions')
  @RequirePermission('election:rules:manage')
  @ScopeFrom('election', 'id')
  addPosition(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: PositionDto, @Req() req: Request) {
    return this.elections.addPosition(u, id, dto, requestInfo(req));
  }

  @Patch('elections/:id/positions/:positionId')
  @RequirePermission('election:rules:manage')
  @ScopeFrom('election', 'id')
  updatePosition(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('positionId') positionId: string, @Body() dto: UpdatePositionDto, @Req() req: Request) {
    return this.elections.updatePosition(u, id, positionId, dto, requestInfo(req));
  }

  @Delete('elections/:id/positions/:positionId')
  @HttpCode(204)
  @RequirePermission('election:rules:manage')
  @ScopeFrom('election', 'id')
  removePosition(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('positionId') positionId: string, @Req() req: Request) {
    return this.elections.removePosition(u, id, positionId, requestInfo(req));
  }

  @Post('elections/:id/candidacy/open')
  @HttpCode(200)
  @RequirePermission('election:candidacy:open')
  @ScopeFrom('election', 'id')
  openCandidacy(@CurrentUser() u: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.elections.openCandidacy(u, id, requestInfo(req));
  }

  @Post('elections/:id/candidacy/close')
  @HttpCode(200)
  @RequirePermission('election:candidacy:close')
  @ScopeFrom('election', 'id')
  closeCandidacy(@CurrentUser() u: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.elections.closeCandidacy(u, id, requestInfo(req));
  }

  /** 🔐 Administrateur d'institution uniquement : le comité n'annule pas sa propre élection. */
  @Post('elections/:id/cancel')
  @HttpCode(200)
  @RequirePermission('election:cancel')
  @ScopeFrom('election', 'id')
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.elections.cancel(u, id, requestInfo(req));
  }

  /** Un nombre, jamais une liste nominative (D-02). */
  @Get('elections/:id/eligible-count')
  @RequirePermission('voter_roll:read:count')
  @ScopeFrom('election', 'id')
  eligibleCount(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.elections.eligibleCount(u, id);
  }
}
