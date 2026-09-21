#!/usr/bin/env bash
# Arranca Postgres e Redis locais para testes e desenvolvimento.
#
# Em máquinas com Docker, prefira `docker compose up -d` — é mais próximo de
# produção. Este script existe para ambientes sem Docker (CI leve, containers
# de desenvolvimento) onde os binários estão instalados diretamente.
set -euo pipefail

PG_PORT="${JELLYCARE_PG_PORT:-55432}"
REDIS_PORT="${JELLYCARE_REDIS_PORT:-56379}"
PG_BIN="${JELLYCARE_PG_BIN:-/usr/lib/postgresql/16/bin}"
PG_USER="${JELLYCARE_PG_OS_USER:-pgtest}"
PG_DATA="${JELLYCARE_PG_DATA:-/home/${PG_USER}/pgdata}"
DB_NAME="${JELLYCARE_TEST_DB:-jellycare_test}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { printf '  %s\n' "$*"; }

# O Postgres recusa-se a correr como root, por isso usamos um utilizador sem
# privilégios dedicado a testes.
if ! id "$PG_USER" >/dev/null 2>&1; then
  log "a criar o utilizador $PG_USER"
  useradd -m "$PG_USER"
fi

if [ ! -d "$PG_DATA" ]; then
  log "a inicializar o cluster em $PG_DATA"
  su "$PG_USER" -c "$PG_BIN/initdb -D $PG_DATA -U postgres --auth=trust" >/dev/null
fi

if ! su "$PG_USER" -c "$PG_BIN/pg_ctl -D $PG_DATA status" >/dev/null 2>&1; then
  log "a arrancar o Postgres na porta $PG_PORT"
  su "$PG_USER" -c "$PG_BIN/pg_ctl -D $PG_DATA -o '-p $PG_PORT -k /tmp' -l /home/$PG_USER/pg.log start" >/dev/null
fi

until psql "postgres://postgres@localhost:$PG_PORT/postgres" -tAc 'select 1' >/dev/null 2>&1; do
  sleep 1
done

if ! psql "postgres://postgres@localhost:$PG_PORT/postgres" -tAc \
  "select 1 from pg_database where datname = '$DB_NAME'" | grep -q 1; then
  log "a criar a base de dados $DB_NAME"
  psql "postgres://postgres@localhost:$PG_PORT/postgres" -c "create database $DB_NAME" >/dev/null
fi

log "a aplicar migrações"
for migration in "$REPO_ROOT"/packages/db/migrations/*.sql; do
  psql "postgres://postgres@localhost:$PG_PORT/$DB_NAME" -v ON_ERROR_STOP=1 -q -f "$migration" >/dev/null 2>&1 || true
done

if ! redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1; then
  log "a arrancar o Redis na porta $REDIS_PORT"
  redis-server --port "$REDIS_PORT" --daemonize yes --save '' --appendonly no >/dev/null
  until redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1; do sleep 1; done
fi

cat <<EOF

Serviços prontos.

  TEST_DATABASE_URL=postgres://postgres@localhost:$PG_PORT/$DB_NAME
  TEST_REDIS_URL=redis://localhost:$REDIS_PORT
EOF
