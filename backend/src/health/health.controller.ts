import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { HealthService } from './health.service';

// TODO Sprint 2 : @Public() dès que le guard d'authentification global existe.
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** 200 si l'API et la base répondent, 503 si la base est injoignable. */
  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const status = await this.health.check();
    if (status.database !== 'ok') res.status(503);
    return status;
  }
}
