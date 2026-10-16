import { Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthUser } from '../common/authz/auth-user';
import { CurrentUser, RequirePermission, ScopeFrom } from '../common/authz/decorators';
import { requestInfo } from '../common/http/request-info';
import { ResultsService } from './results.service';

/**
 * Résultats (03 §5.7, 04 §6.2). Avant VOTING_CLOSED, toutes ces routes refusent (409), pour tous les rôles.
 * Le personnel lit à partir de la clôture ; les électeurs à partir de la publication.
 */
@ApiTags('results')
@Controller()
export class ResultsController {
  constructor(private readonly results: ResultsService) {}

  @Get('results/:id')
  @RequirePermission('results:read', 'results:read:published')
  @ScopeFrom('election', 'id')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.results.get(u, id);
  }

  @Get('results/:id/second-round')
  @RequirePermission('results:read')
  @ScopeFrom('election', 'id')
  secondRound(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.results.secondRound(u, id);
  }

  /** 🔐 Relance du décompte automatique (idempotent). */
  @Post('results/:id/compute')
  @HttpCode(200)
  @RequirePermission('results:compute')
  @ScopeFrom('election', 'id')
  compute(@CurrentUser() u: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.results.recompute(u, id, requestInfo(req));
  }

  /** 🔐 */
  @Post('elections/:id/results/publish')
  @HttpCode(200)
  @RequirePermission('results:publish')
  @ScopeFrom('election', 'id')
  publish(@CurrentUser() u: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.results.publish(u, id, requestInfo(req));
  }
}
