#!/bin/bash
# Exécuté une seule fois, à la première initialisation du volume MySQL.
# Crée les 3 comptes de 02-DATABASE.md §10. Les droits fins sont posés par la migration *_db_grants.
set -euo pipefail
mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" <<SQL
CREATE USER IF NOT EXISTS 'app_migrate'@'%'  IDENTIFIED BY '${APP_MIGRATE_PASSWORD}';
CREATE USER IF NOT EXISTS 'app_runtime'@'%'  IDENTIFIED BY '${APP_RUNTIME_PASSWORD}';
CREATE USER IF NOT EXISTS 'app_readonly'@'%' IDENTIFIED BY '${APP_READONLY_PASSWORD}';
-- app_migrate : DDL complet sur la base de l'application, uniquement pour 'prisma migrate deploy'.
GRANT ALL PRIVILEGES ON \`${MYSQL_DATABASE}\`.* TO 'app_migrate'@'%' WITH GRANT OPTION;
FLUSH PRIVILEGES;
SQL
