-- Sprint 6B (D-42, D-45) : un procès-verbal par langue. Deux lignes par rapport, même identifiant et même code,
-- chacune avec son PDF et son SHA-256 ; l'empreinte de l'urne imprimée est conservée pour la comparer à l'urne recalculée.
-- La table est vide à ce stade (aucun PV n'était généré avant ce sprint).

-- DropIndex
DROP INDEX `election_reports_verificationCode_key` ON `election_reports`;

-- AlterTable
ALTER TABLE `election_reports`
    ADD COLUMN `reportId` CHAR(36) NOT NULL,
    ADD COLUMN `language` ENUM('FR', 'AR') NOT NULL,
    ADD COLUMN `ballotsDigest` CHAR(64) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `election_reports_reportId_language_key` ON `election_reports`(`reportId`, `language`);

-- CreateIndex
CREATE UNIQUE INDEX `election_reports_verificationCode_language_key` ON `election_reports`(`verificationCode`, `language`);
