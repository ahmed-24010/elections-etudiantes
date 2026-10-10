#!/bin/bash
# Exécuté une seule fois, à la première initialisation du volume MySQL (et par la CI, avec MYSQL_HOST=127.0.0.1).
# Crée les 3 comptes de 02-DATABASE.md §10. Les droits fins sont posés par la migration *_db_grants.
set -euo pipefail
# MYSQL_HOST vide (Docker) : socket locale. Renseigné (CI) : connexion TCP au service MySQL.
mysql ${MYSQL_HOST:+-h "$MYSQL_HOST" --protocol=TCP} -uroot -p"${MYSQL_ROOT_PASSWORD}" <<SQL
CREATE USER IF NOT EXISTS 'app_migrate'@'%'  IDENTIFIED BY '${APP_MIGRATE_PASSWORD}';
CREATE USER IF NOT EXISTS 'app_runtime'@'%'  IDENTIFIED BY '${APP_RUNTIME_PASSWORD}';
CREATE USER IF NOT EXISTS 'app_readonly'@'%' IDENTIFIED BY '${APP_READONLY_PASSWORD}';
-- app_migrate : DDL complet sur la base de l'application, uniquement pour 'prisma migrate deploy'.
GRANT ALL PRIVILEGES ON \`${MYSQL_DATABASE}\`.* TO 'app_migrate'@'%' WITH GRANT OPTION;
FLUSH PRIVILEGES;
SQL
