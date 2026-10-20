import { Controller, Get, Header, HttpCode, Param, Post, Query, Req, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthUser } from '../common/authz/auth-user';
import { CurrentUser, RequirePermission, ScopeFrom } from '../common/authz/decorators';
import { requestInfo } from '../common/http/request-info';
import { ReportLangQuery } from './reports.dto';
import { ReportsService } from './reports.service';

/** Procès-verbal (03 §5.7, D-41 à D-43) : lecture par le personnel, (re)génération 🔐 par le comité et l'administrateur d'institution. */
@ApiTags('reports')
@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** 🔐 Regénère le PV (deux langues) : nouveau rapport, nouvel identifiant. Seulement une fois les résultats publiés. */
  @Post('elections/:id/report')
  @HttpCode(200)
  @RequirePermission('report:generate')
  @ScopeFrom('election', 'id')
  generate(@CurrentUser() u: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.reports.generate(u, id, requestInfo(req));
  }

  @Get('elections/:id/reports')
  @RequirePermission('report:read')
  @ScopeFrom('election', 'id')
  list(@Param('id') id: string) {
    return this.reports.list(id);
  }

  /** Télécharge le PV dans la langue demandée. Jamais mis en cache ; chaque téléchargement est audité. */
  @Get('elections/:id/report/download')
  @RequirePermission('report:read')
  @ScopeFrom('election', 'id')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async download(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query() q: ReportLangQuery, @Req() req: Request) {
    const { buffer, filename } = await this.reports.download(u, id, q.lang, requestInfo(req));
    return new StreamableFile(buffer, { type: 'application/pdf', disposition: `attachment; filename="${filename}"` });
  }
}
