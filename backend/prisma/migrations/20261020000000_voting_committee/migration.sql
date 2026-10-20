-- Sprint 6A (D-38, D-39) : prolongation unique du vote après panne, ajout exceptionnel d'un électeur après le gel.

-- AlterTable
ALTER TABLE `elections` ADD COLUMN `votingExtendedAt` DATETIME(3) NULL,
    ADD COLUMN `votingEndsAtOriginal` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `voter_roll` ADD COLUMN `addedAfterFreeze` BOOLEAN NOT NULL DEFAULT false;
