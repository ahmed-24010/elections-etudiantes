import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../common/authz/decorators';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** 200 si l'API et la base répondent, 503 si la base est injoignable. */
  @Public()
  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const status = await this.health.check();
    if (status.database !== 'ok') res.status(503);
    return status;
  }
}
