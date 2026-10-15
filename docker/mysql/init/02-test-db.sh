#!/bin/bash
# Base SÉPARÉE pour « npm run test:db » : ces tests créent des milliers de lignes et ne doivent jamais toucher la base de
# développement. Exécuté à la première initialisation du volume ; pour un volume existant :
#   docker compose exec -T db bash /docker-entrypoint-initdb.d/02-test-db.sh
# (et par la CI, avec MYSQL_HOST=127.0.0.1 et MYSQL_DATABASE=elections : la base de test s'appelle elections_test).
# Le schéma y est posé par « prisma migrate deploy » (app_migrate), comme pour la base de développement.
set -euo pipefail
mysql ${MYSQL_HOST:+-h "$MYSQL_HOST" --protocol=TCP} -uroot -p"${MYSQL_ROOT_PASSWORD}" <<SQL
CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}_test\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
GRANT ALL PRIVILEGES ON \`${MYSQL_DATABASE}_test\`.* TO 'app_migrate'@'%' WITH GRANT OPTION;
FLUSH PRIVILEGES;
SQL
