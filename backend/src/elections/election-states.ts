import { ElectionStatus } from '@prisma/client';

/** États que l'étudiant peut voir : jamais un brouillon ni une élection annulée. */
export const STUDENT_VISIBLE: readonly ElectionStatus[] = [
  ElectionStatus.CANDIDACY_OPEN,
  ElectionStatus.CANDIDACY_CLOSED,
  ElectionStatus.VOTING_OPEN,
  ElectionStatus.VOTING_CLOSED,
  ElectionStatus.RESULTS_PUBLISHED,
];
