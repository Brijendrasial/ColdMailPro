#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

bash scripts/verify-migrations.sh

echo "==> Applying Prisma migrations"
npx prisma migrate deploy

echo "==> Generating Prisma client"
npx prisma generate

echo "==> Seeding database"
npm run seed

echo "✅ Database setup complete"
