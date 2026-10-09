import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../common/authz/decorators';
import { AuditService } from './audit.service';

@ApiTags('audit')
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** Contrôle d'intégrité de la chaîne de hachage (03 §5.8). Ne renvoie aucun contenu du journal. */
  @Get('verify-chain')
  @RequirePermission('audit:verify_chain')
  verifyChain() {
    return this.audit.verifyChain();
  }
}
