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
    const links = await this.prisma.programLevel.findMany({ where: { programId: { in: programs.map((p) => p.id) } } });
    // levelIds : niveaux où la filière existe (D-24), pour l'écran d'inscription et la grille des groupes.
    return { years, faculties, programs: programs.map((p) => ({ ...p, levelIds: links.filter((l) => l.programId === p.id).map((l) => l.levelId) })), levels, groups };
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

  /** Les niveaux demandés doivent tous appartenir à CETTE institution (relus en base). */
  private async assertLevels(institutionId: string, levelIds: string[]) {
    if (levelIds.length === 0) return;
    const found = await this.prisma.level.count({ where: { institutionId, id: { in: levelIds } } });
    if (found !== levelIds.length) throw new NotFoundException();
  }

  async createProgram(actor: AuthUser, institutionId: string, dto: ProgramDto, info: RequestInfo) {
    // La faculté doit appartenir à CETTE institution (lue en base, pas fiée au client).
    this.notFound(await this.prisma.faculty.findFirst({ where: { id: dto.facultyId, institutionId } }));
    const { levelIds, ...data } = dto;
    await this.assertLevels(institutionId, levelIds);
    const row = await this.write(actor, institutionId, 'program', 'CREATED', info, () =>
      this.prisma.$transaction(async (tx) => {
        const program = await tx.program.create({ data: { ...data, institutionId } });
        await tx.programLevel.createMany({ data: levelIds.map((levelId) => ({ programId: program.id, levelId })) });
        return program;
      }),
    );
    return { ...row, levelIds };
  }

  async updateProgram(actor: AuthUser, institutionId: string, id: string, dto: UpdateProgramDto, info: RequestInfo) {
    this.notFound(await this.prisma.program.findFirst({ where: { id, institutionId } }));
    const { levelIds, ...data } = dto;
    if (levelIds) await this.assertLevels(institutionId, levelIds);
    const row = await this.write(actor, institutionId, 'program', 'UPDATED', info, async () => {
      if (!levelIds) return this.prisma.program.update({ where: { id }, data });
      const current = (await this.prisma.programLevel.findMany({ where: { programId: id } })).map((l) => l.levelId);
      const removed = current.filter((l) => !levelIds.includes(l));
      // On ne retire pas un niveau où la filière a déjà des groupes ou des inscriptions.
      if (removed.length) {
        this.inUse(
          await this.prisma.group.count({ where: { programId: id, levelId: { in: removed } } }),
          await this.prisma.studentEnrollment.count({ where: { programId: id, levelId: { in: removed } } }),
        );
      }
      return this.prisma.$transaction(async (tx) => {
        if (removed.length) await tx.programLevel.deleteMany({ where: { programId: id, levelId: { in: removed } } });
        await tx.programLevel.createMany({ data: levelIds.filter((l) => !current.includes(l)).map((levelId) => ({ programId: id, levelId })) });
        return tx.program.update({ where: { id }, data });
      });
    });
    const links = await this.prisma.programLevel.findMany({ where: { programId: id } });
    return { ...row, levelIds: links.map((l) => l.levelId) };
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
    // D-24 : pas de groupe d'une filière dans un niveau où elle n'existe pas (ex. Droit privé en L1).
    if (!(await this.prisma.programLevel.findUnique({ where: { programId_levelId: { programId: dto.programId, levelId: dto.levelId } } }))) {
      throw new BadRequestException('level_not_allowed_for_program');
    }
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
