-- Sprint 4 (D-24) : niveaux où une filière existe (tronc commun en L1-L2, spécialités dès L3 à la FSJP).

-- CreateTable
CREATE TABLE `program_levels` (
    `programId` CHAR(36) NOT NULL,
    `levelId` CHAR(36) NOT NULL,

    INDEX `program_levels_levelId_idx`(`levelId`),
    PRIMARY KEY (`programId`, `levelId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `program_levels` ADD CONSTRAINT `program_levels_programId_fkey` FOREIGN KEY (`programId`) REFERENCES `programs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `program_levels` ADD CONSTRAINT `program_levels_levelId_fkey` FOREIGN KEY (`levelId`) REFERENCES `levels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Les filières existantes gardent tous les niveaux de leur institution : le comportement actuel ne change pas
-- tant que l'administrateur d'institution n'a pas restreint les niveaux.
INSERT INTO `program_levels` (`programId`, `levelId`)
SELECT p.`id`, l.`id` FROM `programs` p JOIN `levels` l ON l.`institutionId` = p.`institutionId`;

-- Droits (02 §10) : même régime que les autres tables de structure académique.
SET @s = CONCAT('GRANT SELECT, INSERT, UPDATE, DELETE ON `', DATABASE(), '`.`program_levels` TO ''app_runtime''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT ON `', DATABASE(), '`.`program_levels` TO ''app_readonly''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
