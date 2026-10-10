-- Sprint 2 (D-19) : une seule ligne peut suivre un hash donné, donc la chaîne ne peut pas bifurquer.
CREATE UNIQUE INDEX `audit_logs_prevHash_key` ON `audit_logs`(`prevHash`);
