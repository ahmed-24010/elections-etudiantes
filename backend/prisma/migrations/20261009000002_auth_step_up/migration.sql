-- Sprint 2 (D-15, D-18) : migration additive, aucune donnée existante modifiée.
ALTER TABLE `users` ADD COLUMN `setupTokenJti` CHAR(36) NULL;
ALTER TABLE `refresh_tokens` ADD COLUMN `twoFactorVerifiedAt` DATETIME(3) NULL;
