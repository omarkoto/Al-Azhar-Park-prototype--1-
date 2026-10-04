#!/bin/sh
# Runs once, the first time the PostgreSQL volume is created.
# Creates the extra database used by the automated tests (same name pattern as the local setup).
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-EOSQL
  CREATE DATABASE ${POSTGRES_DB}_test OWNER ${POSTGRES_USER} ENCODING 'UTF8';
EOSQL

echo "created database ${POSTGRES_DB}_test"
