-- Sprint 6C (D-47) : « PV signé » — le comité atteste que l'exemplaire imprimé a été signé (les deux langues du rapport).

-- AlterTable
ALTER TABLE `election_reports` ADD COLUMN `signedAt` DATETIME(3) NULL,
    ADD COLUMN `signedById` CHAR(36) NULL;
