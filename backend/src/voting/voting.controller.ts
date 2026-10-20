import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthUser } from '../common/authz/auth-user';
import { CurrentUser, RequirePermission, ScopeFrom } from '../common/authz/decorators';
import { requestInfo } from '../common/http/request-info';
import { AddVoterDto, CastBallotDto, CloseVotingDto, ExtendVotingDto, VoterLookupDto } from './voting.dto';
import { VoterRollService } from './voter-roll.service';
import { VotingLifecycleService } from './voting-lifecycle.service';
import { VotingService } from './voting.service';

/**
 * Vote (03 §5.6, 04 §6). La portée (institution, élection) est relue en base. Le corps de `POST /voting/:id/ballot`
 * n'est jamais journalisé : le logger HTTP ne lit pas les corps (voir app.module.ts), et ce contrôleur n'en écrit aucun.
 */
@ApiTags('voting')
@Controller()
export class VotingController {
  constructor(
    private readonly voting: VotingService,
    private readonly lifecycle: VotingLifecycleService,
    private readonly voterRoll: VoterRollService,
  ) {}

  @Post('voting/:id/ballot')
  @RequirePermission('ballot:cast')
  @ScopeFrom('election', 'id')
  cast(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: CastBallotDto) {
    return this.voting.cast(u, id, dto);
  }

  /** Bulletin vierge (candidats en ordre aléatoire). 409 ALREADY_VOTED après le vote : un bulletin ne se relit jamais. */
  @Get('voting/:id/ballot')
  @RequirePermission('ballot:cast')
  @ScopeFrom('election', 'id')
  ballot(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.voting.ballot(u, id);
  }

  /** L'état de l'étudiant lui-même : inscrit ? a voté ? */
  @Get('voting/:id/status')
  @RequirePermission('participation:read:self')
  @ScopeFrom('election', 'id')
  status(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.voting.status(u, id);
  }

  /** 🔐 Ouverture manuelle (comité, admin d'institution). */
  @Post('elections/:id/voting/open')
  @HttpCode(200)
  @RequirePermission('election:voting:open')
  @ScopeFrom('election', 'id')
  open(@CurrentUser() u: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.lifecycle.open(u, id, requestInfo(req));
  }

  /** 🔐 Clôture anticipée, motif obligatoire. */
  @Post('elections/:id/voting/close')
  @HttpCode(200)
  @RequirePermission('election:voting:close')
  @ScopeFrom('election', 'id')
  close(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: CloseVotingDto, @Req() req: Request) {
    return this.lifecycle.close(u, id, dto.reason, requestInfo(req));
  }

  /** 🔐 Prolongation unique après panne (D-33, D-38) : panne déclarée, nouvelle fin, motif. */
  @Post('elections/:id/voting/extend')
  @HttpCode(200)
  @RequirePermission('election:voting:extend')
  @ScopeFrom('election', 'id')
  extend(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ExtendVotingDto, @Req() req: Request) {
    return this.lifecycle.extend(u, id, dto, requestInfo(req));
  }

  /** 🔐 Confirmation d'un ajout exceptionnel : filière, niveau et groupe seulement, jamais le nom (D-39). N'écrit rien. */
  @Post('elections/:id/voter-roll/preview')
  @HttpCode(200)
  @RequirePermission('voter_roll:add')
  @ScopeFrom('election', 'id')
  previewVoter(@Param('id') id: string, @Body() dto: VoterLookupDto) {
    return this.voterRoll.preview(id, dto.studentNumber);
  }

  /** 🔐 Ajout exceptionnel après le gel (04 §5.2, D-39), motif obligatoire. */
  @Post('elections/:id/voter-roll')
  @HttpCode(200)
  @RequirePermission('voter_roll:add')
  @ScopeFrom('election', 'id')
  addVoter(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: AddVoterDto, @Req() req: Request) {
    return this.voterRoll.add(u, id, dto.studentNumber, dto.reason, requestInfo(req));
  }

  /** « X votants sur Y inscrits » : des chiffres, jamais une liste nominative (D-02). */
  @Get('elections/:id/turnout')
  @RequirePermission('turnout:read')
  @ScopeFrom('election', 'id')
  turnout(@Param('id') id: string) {
    return this.voting.turnout(id);
  }
}
