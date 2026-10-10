import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/authz/decorators';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('institutions')
@Controller('institutions')
export class InstitutionsController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liste publique pour l'inscription : institutions actives, code et nom uniquement. */
  @Public()
  @Get('public')
  list() {
    return this.prisma.institution.findMany({
      where: { isActive: true },
      select: { code: true, name: true },
      orderBy: { name: 'asc' },
    });
  }
}
