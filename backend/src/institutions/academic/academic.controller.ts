import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthUser } from '../../common/authz/auth-user';
import { CurrentUser, RequirePermission, ScopeFrom } from '../../common/authz/decorators';
import { requestInfo } from '../../common/http/request-info';
import { AcademicYearDto, FacultyDto, GroupDto, LevelDto, ProgramDto, UpdateAcademicYearDto, UpdateFacultyDto, UpdateGroupDto, UpdateLevelDto, UpdateProgramDto } from './academic.dto';
import { AcademicService } from './academic.service';

/**
 * Structure académique : lecture pour tous les rôles de l'institution (`academic:read`), écriture pour l'administrateur
 * d'institution uniquement (`academic:manage`). La portée est l'institution du chemin, relue en base par le guard.
 */
@ApiTags('academic')
@Controller('institutions/:institutionId/academic')
export class AcademicController {
  constructor(private readonly academic: AcademicService) {}

  @Get()
  @RequirePermission('academic:read')
  @ScopeFrom('institution', 'institutionId')
  overview(@Param('institutionId') institutionId: string) {
    return this.academic.overview(institutionId);
  }

  // ---- facultés
  @Post('faculties')
  @RequirePermission('academic:manage')
  @ScopeFrom('institution', 'institutionId')
  createFaculty(@CurrentUser() u: AuthUser, @Param('institutionId') i: string, @Body() dto: FacultyDto, @Req() req: Request) {
    return this.academic.createFaculty(u, i, dto, requestInfo(req));
  }

  @Patch('faculties/:id')
  @RequirePermission('academic:manage')
  @ScopeFrom('institution', 'institutionId')
  updateFaculty(@CurrentUser() u: AuthUser, @Param('institutionId') i: string, @Param('id') id: string, @Body() dto: UpdateFacultyDto, @Req() req: Request) {
    return this.academic.updateFaculty(u, i, id, dto, requestInfo(req));
  }

  @Delete('faculties/:id')
  @HttpCode(204)
  @RequirePermission('academic:manage')
  @ScopeFrom('institution', 'institutionId')
  deleteFaculty(@CurrentUser() u: AuthUser, @Param('institutionId') i: string, @Param('id') id: string, @Req() req: Request) {
    return this.academic.deleteFaculty(u, i, id, requestInfo(req));
  }

  // ---- filières
  @Post('programs')
  @RequirePermission('academic:manage')
  @ScopeFrom('institution', 'institutionId')
  createProgram(@CurrentUser() u: AuthUser, @Param('institutionId') i: string, @Body() dto: ProgramDto, @Req() req: Request) {
    return this.academic.createProgram(u, i, dto, requestInfo(req));
  }

  @Patch('programs/:id')
  @RequirePermission('academic:manage')
  @ScopeFrom('institution', 'institutionId')
  updateProgram(@CurrentUser() u: AuthUser, @Param('institutionId') i: string, @Param('id') id: string, @Body() dto: UpdateProgramDto, @Req() req: Request) {
    return this.academic.updateProgram(u, i, id, dto, requestInfo(req));
  }

  @Delete('programs/:id')
  @HttpCode(204)
  @RequirePermission('academic:manage')
  @ScopeFrom('institution', 'institutionId')
  deleteProgram(@CurrentUser() u: AuthUser, @Param('institutionId') i: string, @Param('id') id: string, @Req() req: Request) {
    return this.academic.deleteProgram(u, i, id, requestInfo(req));
  }

  // ---- niveaux
  @Post('levels')
  @RequirePermission('academic:manage')
  @ScopeFrom('institution', 'institutionId')
  createLevel(@CurrentUser() u: AuthUser, @Param('institutionId') i: string, @Body() dto: LevelDto, @Req() req: Request) {
    return this.academic.createLevel(u, i, dto, requestInfo(req));
  }

  @Patch('levels/:id')
  @RequirePermission('academic:manage')
  @ScopeFrom('institution', 'institutionId')
  updateLevel(@CurrentUser() u: AuthUser, @Param('institutionId') i: string, @Param('id') id: string, @Body() dto: UpdateLevelDto, @Req() req: Request) {
    return this.academic.updateLevel(u, i, id, dto, requestInfo(req));
  }

  @Delete('levels/:id')
  @HttpCode(204)
  @RequirePermission('academic:manage')
  @ScopeFrom('institution', 'institutionId')
  deleteLevel(@CurrentUser() u: AuthUser, @Param('institutionId') i: string, @Param('id') id: string, @Req() req: Request) {
    return this.academic.deleteLevel(u, i, id, requestInfo(req));
  }

  // ---- années universitaires
  @Post('years')
  @RequirePermission('academic:manage')
  @ScopeFrom('institution', 'institutionId')
  createYear(@CurrentUser() u: AuthUser, @Param('institutionId') i: string, @Body() dto: AcademicYearDto, @Req() req: Request) {
    return this.academic.createYear(u, i, dto, requestInfo(req));
  }

  @Patch('years/:id')
  @RequirePermission('academic:manage')
  @ScopeFrom('institution', 'institutionId')
  updateYear(@CurrentUser() u: AuthUser, @Param('institutionId') i: string, @Param('id') id: string, @Body() dto: UpdateAcademicYearDto, @Req() req: Request) {
    return this.academic.updateYear(u, i, id, dto, requestInfo(req));
  }

  @Post('years/:id/current')
  @HttpCode(200)
  @RequirePermission('academic:manage')
  @ScopeFrom('institution', 'institutionId')
  setCurrentYear(@CurrentUser() u: AuthUser, @Param('institutionId') i: string, @Param('id') id: string, @Req() req: Request) {
    return this.academic.setCurrentYear(u, i, id, requestInfo(req));
  }

  @Delete('years/:id')
  @HttpCode(204)
  @RequirePermission('academic:manage')
  @ScopeFrom('institution', 'institutionId')
  deleteYear(@CurrentUser() u: AuthUser, @Param('institutionId') i: string, @Param('id') id: string, @Req() req: Request) {
    return this.academic.deleteYear(u, i, id, requestInfo(req));
  }

  // ---- groupes
  @Post('groups')
  @RequirePermission('academic:manage')
  @ScopeFrom('institution', 'institutionId')
  createGroup(@CurrentUser() u: AuthUser, @Param('institutionId') i: string, @Body() dto: GroupDto, @Req() req: Request) {
    return this.academic.createGroup(u, i, dto, requestInfo(req));
  }

  @Patch('groups/:id')
  @RequirePermission('academic:manage')
  @ScopeFrom('institution', 'institutionId')
  updateGroup(@CurrentUser() u: AuthUser, @Param('institutionId') i: string, @Param('id') id: string, @Body() dto: UpdateGroupDto, @Req() req: Request) {
    return this.academic.updateGroup(u, i, id, dto, requestInfo(req));
  }

  @Delete('groups/:id')
  @HttpCode(204)
  @RequirePermission('academic:manage')
  @ScopeFrom('institution', 'institutionId')
  deleteGroup(@CurrentUser() u: AuthUser, @Param('institutionId') i: string, @Param('id') id: string, @Req() req: Request) {
    return this.academic.deleteGroup(u, i, id, requestInfo(req));
  }
}
