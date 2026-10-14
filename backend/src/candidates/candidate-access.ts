import { CandidateStatus, ElectionStatus, Role } from '@prisma/client';
import type { RoleGrant } from '../common/authz/auth-user';
import { STUDENT_VISIBLE } from '../elections/election-states';

export interface FileViewer {
  id: string;
  roles: Pick<RoleGrant, 'role' | 'institutionId' | 'electionId'>[];
}

/**
 * Qui lit la photo ou le programme d'un candidat : le candidat lui-même ; le personnel de l'élection (IA de l'institution,
 * comité de CETTE élection, SA) ; et tout étudiant de l'institution, mais seulement pour un candidat VALIDÉ d'une élection
 * visible. Le rôle de l'URL signée est d'être émise par un endpoint qui a déjà contrôlé l'éligibilité ; ceci revérifie à la lecture.
 */
export function canViewCandidateFile(
  viewer: FileViewer,
  candidate: { status: CandidateStatus; student: { userId: string } },
  election: { id: string; institutionId: string; status: ElectionStatus },
): boolean {
  if (candidate.student.userId === viewer.id) return true;
  const staff = viewer.roles.some(
    (r) =>
      r.role === Role.SUPER_ADMIN ||
      (r.role === Role.INSTITUTION_ADMIN && r.institutionId === election.institutionId) ||
      (r.role === Role.ELECTION_COMMITTEE && r.electionId === election.id),
  );
  if (staff) return true;
  return (
    candidate.status === CandidateStatus.APPROVED &&
    STUDENT_VISIBLE.includes(election.status) &&
    viewer.roles.some((r) => r.role === Role.STUDENT && r.institutionId === election.institutionId)
  );
}
