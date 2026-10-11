import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditResult, Prisma } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import type { RequestInfo } from '../../auth/auth.service';
import type { AuthUser } from '../../common/authz/auth-user';
import { PrismaService } from '../../prisma/prisma.service';
import type { AcademicYearDto, FacultyDto, GroupDto, LevelDto, ProgramDto, UpdateAcademicYearDto, UpdateFacultyDto, UpdateGroupDto, UpdateLevelDto, UpdateProgramDto } from './academic.dto';

type Entity = 'faculty' | 'program' | 'level' | 'year' | 'group';

/**
 * Structure académique d'une institution (02 §4.2). Toute requête est bornée à `institutionId` (lu en base par le guard) :
 * un identifiant d'une autre institution renvoie 404, jamais un accès.
 */
@Injectable()
export class AcademicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ lecture

  async overview(institutionId: string) {
    const [years, faculties, programs, levels, groups] = await Promise.all([
      this.prisma.academicYear.findMany({ where: { institutionId }, orderBy: { startsOn: 'desc' } }),
      this.prisma.faculty.findMany({ where: { institutionId }, orderBy: { code: 'asc' } }),
      this.prisma.program.findMany({ where: { institutionId }, orderBy: { code: 'asc' } }),
      this.prisma.level.findMany({ where: { institutionId }, orderBy: { rank: 'asc' } }),
      this.prisma.group.findMany({ where: { institutionId }, orderBy: { name: 'asc' } }),
    ]);
    return { years, faculties, programs, levels, groups };
  }

  // ------------------------------------------------------------------ écriture : utilitaires

  private async write<T extends { id: string }>(
    actor: AuthUser,
    institutionId: string,
    entity: Entity,
    op: 'CREATED' | 'UPDATED' | 'DELETED',
    info: RequestInfo,
    run: () => Promise<T>,
  ): Promise<T> {
    let row: T;
    try {
      row = await run();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('already_exists');
      throw e;
    }
    await this.audit.record({
      actorId: actor.id,
      institutionId,
      action: `ACADEMIC_${op}`,
      resourceType: entity,
      resourceId: row.id,
      result: AuditResult.SUCCESS,
      ip: info.ip,
      requestId: info.requestId,
    });
    return row;
  }

  private notFound<T>(row: T | null): T {
    if (!row) throw new NotFoundException();
    return row;
  }

  private inUse(...counts: number[]): void {
    if (counts.some((c) => c > 0)) throw new ConflictException('in_use');
  }

  // ------------------------------------------------------------------ facultés

  createFaculty(actor: AuthUser, institutionId: string, dto: FacultyDto, info: RequestInfo) {
    return this.write(actor, institutionId, 'faculty', 'CREATED', info, () => this.prisma.faculty.create({ data: { ...dto, institutionId } }));
  }

  async updateFaculty(actor: AuthUser, institutionId: string, id: string, dto: UpdateFacultyDto, info: RequestInfo) {
    this.notFound(await this.prisma.faculty.findFirst({ where: { id, institutionId } }));
    return this.write(actor, institutionId, 'faculty', 'UPDATED', info, () => this.prisma.faculty.update({ where: { id }, data: dto }));
  }

  async deleteFaculty(actor: AuthUser, institutionId: string, id: string, info: RequestInfo) {
    this.notFound(await this.prisma.faculty.findFirst({ where: { id, institutionId } }));
    this.inUse(await this.prisma.program.count({ where: { facultyId: id } }), await this.prisma.studentEnrollment.count({ where: { facultyId: id } }));
    await this.write(actor, institutionId, 'faculty', 'DELETED', info, () => this.prisma.faculty.delete({ where: { id } }));
  }

  // ------------------------------------------------------------------ filières

  async createProgram(actor: AuthUser, institutionId: string, dto: ProgramDto, info: RequestInfo) {
    // La faculté doit appartenir à CETTE institution (lue en base, pas fiée au client).
    this.notFound(await this.prisma.faculty.findFirst({ where: { id: dto.facultyId, institutionId } }));
    return this.write(actor, institutionId, 'program', 'CREATED', info, () => this.prisma.program.create({ data: { ...dto, institutionId } }));
  }

  async updateProgram(actor: AuthUser, institutionId: string, id: string, dto: UpdateProgramDto, info: RequestInfo) {
    this.notFound(await this.prisma.program.findFirst({ where: { id, institutionId } }));
    return this.write(actor, institutionId, 'program', 'UPDATED', info, () => this.prisma.program.update({ where: { id }, data: dto }));
  }

  async deleteProgram(actor: AuthUser, institutionId: string, id: string, info: RequestInfo) {
    this.notFound(await this.prisma.program.findFirst({ where: { id, institutionId } }));
    this.inUse(await this.prisma.group.count({ where: { programId: id } }), await this.prisma.studentEnrollment.count({ where: { programId: id } }));
    await this.write(actor, institutionId, 'program', 'DELETED', info, () => this.prisma.program.delete({ where: { id } }));
  }

  // ------------------------------------------------------------------ niveaux

  createLevel(actor: AuthUser, institutionId: string, dto: LevelDto, info: RequestInfo) {
    return this.write(actor, institutionId, 'level', 'CREATED', info, () => this.prisma.level.create({ data: { ...dto, institutionId } }));
  }

  async updateLevel(actor: AuthUser, institutionId: string, id: string, dto: UpdateLevelDto, info: RequestInfo) {
    this.notFound(await this.prisma.level.findFirst({ where: { id, institutionId } }));
    return this.write(actor, institutionId, 'level', 'UPDATED', info, () => this.prisma.level.update({ where: { id }, data: dto }));
  }

  async deleteLevel(actor: AuthUser, institutionId: string, id: string, info: RequestInfo) {
    this.notFound(await this.prisma.level.findFirst({ where: { id, institutionId } }));
    this.inUse(await this.prisma.group.count({ where: { levelId: id } }), await this.prisma.studentEnrollment.count({ where: { levelId: id } }));
    await this.write(actor, institutionId, 'level', 'DELETED', info, () => this.prisma.level.delete({ where: { id } }));
  }

  // ------------------------------------------------------------------ années universitaires

  private checkDates(startsOn: Date, endsOn: Date) {
    if (!(startsOn < endsOn)) throw new BadRequestException('invalid_dates');
  }

  createYear(actor: AuthUser, institutionId: string, dto: AcademicYearDto, info: RequestInfo) {
    const startsOn = new Date(dto.startsOn);
    const endsOn = new Date(dto.endsOn);
    this.checkDates(startsOn, endsOn);
    return this.write(actor, institutionId, 'year', 'CREATED', info, () =>
      this.prisma.academicYear.create({ data: { label: dto.label, startsOn, endsOn, institutionId } }),
    );
  }

  async updateYear(actor: AuthUser, institutionId: string, id: string, dto: UpdateAcademicYearDto, info: RequestInfo) {
    const current = this.notFound(await this.prisma.academicYear.findFirst({ where: { id, institutionId } }));
    const startsOn = dto.startsOn ? new Date(dto.startsOn) : current.startsOn;
    const endsOn = dto.endsOn ? new Date(dto.endsOn) : current.endsOn;
    this.checkDates(startsOn, endsOn);
    return this.write(actor, institutionId, 'year', 'UPDATED', info, () =>
      this.prisma.academicYear.update({ where: { id }, data: { label: dto.label, startsOn, endsOn } }),
    );
  }

  /** Une seule année courante par institution : l'étudiant déclare son inscription pour celle-ci (D-21). */
  async setCurrentYear(actor: AuthUser, institutionId: string, id: string, info: RequestInfo) {
    this.notFound(await this.prisma.academicYear.findFirst({ where: { id, institutionId } }));
    return this.write(actor, institutionId, 'year', 'UPDATED', info, () =>
      this.prisma.$transaction(async (tx) => {
        await tx.academicYear.updateMany({ where: { institutionId, isCurrent: true }, data: { isCurrent: false } });
        return tx.academicYear.update({ where: { id }, data: { isCurrent: true } });
      }),
    );
  }

  async deleteYear(actor: AuthUser, institutionId: string, id: string, info: RequestInfo) {
    this.notFound(await this.prisma.academicYear.findFirst({ where: { id, institutionId } }));
    this.inUse(
      await this.prisma.group.count({ where: { academicYearId: id } }),
      await this.prisma.studentEnrollment.count({ where: { academicYearId: id } }),
      await this.prisma.election.count({ where: { academicYearId: id } }),
    );
    await this.write(actor, institutionId, 'year', 'DELETED', info, () => this.prisma.academicYear.delete({ where: { id } }));
  }

  // ------------------------------------------------------------------ groupes

  async createGroup(actor: AuthUser, institutionId: string, dto: GroupDto, info: RequestInfo) {
    // Filière, niveau et année doivent tous appartenir à cette institution.
    this.notFound(await this.prisma.program.findFirst({ where: { id: dto.programId, institutionId } }));
    this.notFound(await this.prisma.level.findFirst({ where: { id: dto.levelId, institutionId } }));
    this.notFound(await this.prisma.academicYear.findFirst({ where: { id: dto.academicYearId, institutionId } }));
    return this.write(actor, institutionId, 'group', 'CREATED', info, () => this.prisma.group.create({ data: { ...dto, institutionId } }));
  }

  async updateGroup(actor: AuthUser, institutionId: string, id: string, dto: UpdateGroupDto, info: RequestInfo) {
    this.notFound(await this.prisma.group.findFirst({ where: { id, institutionId } }));
    return this.write(actor, institutionId, 'group', 'UPDATED', info, () => this.prisma.group.update({ where: { id }, data: dto }));
  }

  async deleteGroup(actor: AuthUser, institutionId: string, id: string, info: RequestInfo) {
    this.notFound(await this.prisma.group.findFirst({ where: { id, institutionId } }));
    this.inUse(await this.prisma.studentEnrollment.count({ where: { groupId: id } }));
    await this.write(actor, institutionId, 'group', 'DELETED', info, () => this.prisma.group.delete({ where: { id } }));
  }
}
