#!/bin/sh
set -e

# Aplica o schema Prisma no Postgres (cria as tabelas na primeira subida; no-op
# quando já estão em dia). Usa db push porque o projeto não versiona migrations.
echo "[entrypoint] prisma db push..."
npx prisma db push --skip-generate

echo "[entrypoint] starting Maturador..."
exec node dist/index.js
