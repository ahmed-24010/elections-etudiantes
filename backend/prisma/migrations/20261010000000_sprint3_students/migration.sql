-- Sprint 3 (D-22) : un numéro étudiant peut être libéré (NULL) ; le code de rejet distingue « numéro incorrect ».
ALTER TABLE `students` MODIFY `studentNumber` VARCHAR(64) NULL, ADD COLUMN `numberClaimedAt` DATETIME(3) NULL;
-- Les numéros déjà présents sont des réservations existantes : on date la réservation.
UPDATE `students` SET `numberClaimedAt` = `createdAt` WHERE `studentNumber` IS NOT NULL;
ALTER TABLE `student_enrollments` ADD COLUMN `rejectionCode` ENUM('WRONG_STUDENT_NUMBER', 'DOCUMENT_UNREADABLE', 'DATA_MISMATCH', 'OTHER') NULL;
