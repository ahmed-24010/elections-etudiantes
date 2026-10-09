-- Droits des comptes applicatifs (docs/02-DATABASE.md §10).
-- PRÉREQUIS : les comptes app_runtime et app_readonly existent déjà
-- (créés par docker/mysql/init/01-users.sh en Docker, à créer à la main ailleurs).
-- Sinon cette migration échoue volontairement.
-- Le nom de la base est lu via DATABASE() : aucun nom en dur, aucun secret.
--
-- app_runtime : DML sur les tables métier ;
--               audit_logs, ballots, ballot_choices, voting_participations : SELECT + INSERT seulement
--               (jamais de UPDATE ni de DELETE sur l'urne, la participation et l'audit).
-- app_readonly : SELECT partout sauf ballots et ballot_choices.

SET @s = CONCAT('GRANT SELECT, INSERT, UPDATE, DELETE ON `', DATABASE(), '`.`users` TO ''app_runtime''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT, INSERT, UPDATE, DELETE ON `', DATABASE(), '`.`role_assignments` TO ''app_runtime''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT, INSERT, UPDATE, DELETE ON `', DATABASE(), '`.`refresh_tokens` TO ''app_runtime''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT, INSERT, UPDATE, DELETE ON `', DATABASE(), '`.`institutions` TO ''app_runtime''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT, INSERT, UPDATE, DELETE ON `', DATABASE(), '`.`faculties` TO ''app_runtime''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT, INSERT, UPDATE, DELETE ON `', DATABASE(), '`.`programs` TO ''app_runtime''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT, INSERT, UPDATE, DELETE ON `', DATABASE(), '`.`levels` TO ''app_runtime''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT, INSERT, UPDATE, DELETE ON `', DATABASE(), '`.`academic_years` TO ''app_runtime''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT, INSERT, UPDATE, DELETE ON `', DATABASE(), '`.`study_groups` TO ''app_runtime''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT, INSERT, UPDATE, DELETE ON `', DATABASE(), '`.`students` TO ''app_runtime''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT, INSERT, UPDATE, DELETE ON `', DATABASE(), '`.`student_enrollments` TO ''app_runtime''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT, INSERT, UPDATE, DELETE ON `', DATABASE(), '`.`stored_files` TO ''app_runtime''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT, INSERT, UPDATE, DELETE ON `', DATABASE(), '`.`registration_documents` TO ''app_runtime''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT, INSERT, UPDATE, DELETE ON `', DATABASE(), '`.`elections` TO ''app_runtime''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT, INSERT, UPDATE, DELETE ON `', DATABASE(), '`.`eligibility_rules` TO ''app_runtime''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT, INSERT, UPDATE, DELETE ON `', DATABASE(), '`.`positions` TO ''app_runtime''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT, INSERT, UPDATE, DELETE ON `', DATABASE(), '`.`candidates` TO ''app_runtime''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT, INSERT, UPDATE, DELETE ON `', DATABASE(), '`.`voter_roll` TO ''app_runtime''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT, INSERT ON `', DATABASE(), '`.`voting_participations` TO ''app_runtime''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT, INSERT ON `', DATABASE(), '`.`ballots` TO ''app_runtime''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT, INSERT ON `', DATABASE(), '`.`ballot_choices` TO ''app_runtime''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT, INSERT, UPDATE, DELETE ON `', DATABASE(), '`.`election_tallies` TO ''app_runtime''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT, INSERT, UPDATE, DELETE ON `', DATABASE(), '`.`position_results` TO ''app_runtime''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT, INSERT, UPDATE, DELETE ON `', DATABASE(), '`.`election_reports` TO ''app_runtime''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT, INSERT ON `', DATABASE(), '`.`audit_logs` TO ''app_runtime''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT, INSERT, UPDATE, DELETE ON `', DATABASE(), '`.`notifications` TO ''app_runtime''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = CONCAT('GRANT SELECT ON `', DATABASE(), '`.`users` TO ''app_readonly''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT ON `', DATABASE(), '`.`role_assignments` TO ''app_readonly''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT ON `', DATABASE(), '`.`refresh_tokens` TO ''app_readonly''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT ON `', DATABASE(), '`.`institutions` TO ''app_readonly''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT ON `', DATABASE(), '`.`faculties` TO ''app_readonly''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT ON `', DATABASE(), '`.`programs` TO ''app_readonly''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT ON `', DATABASE(), '`.`levels` TO ''app_readonly''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT ON `', DATABASE(), '`.`academic_years` TO ''app_readonly''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT ON `', DATABASE(), '`.`study_groups` TO ''app_readonly''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT ON `', DATABASE(), '`.`students` TO ''app_readonly''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT ON `', DATABASE(), '`.`student_enrollments` TO ''app_readonly''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT ON `', DATABASE(), '`.`stored_files` TO ''app_readonly''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT ON `', DATABASE(), '`.`registration_documents` TO ''app_readonly''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT ON `', DATABASE(), '`.`elections` TO ''app_readonly''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT ON `', DATABASE(), '`.`eligibility_rules` TO ''app_readonly''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT ON `', DATABASE(), '`.`positions` TO ''app_readonly''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT ON `', DATABASE(), '`.`candidates` TO ''app_readonly''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT ON `', DATABASE(), '`.`voter_roll` TO ''app_readonly''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT ON `', DATABASE(), '`.`voting_participations` TO ''app_readonly''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT ON `', DATABASE(), '`.`election_tallies` TO ''app_readonly''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT ON `', DATABASE(), '`.`position_results` TO ''app_readonly''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT ON `', DATABASE(), '`.`election_reports` TO ''app_readonly''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT ON `', DATABASE(), '`.`audit_logs` TO ''app_readonly''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = CONCAT('GRANT SELECT ON `', DATABASE(), '`.`notifications` TO ''app_readonly''@''%'''); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
