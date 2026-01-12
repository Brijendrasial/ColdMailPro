#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MIG_DIR="$ROOT_DIR/prisma/migrations"
EXPECTED="20260112000000_init"

if [[ ! -d "$MIG_DIR" ]]; then
  echo "ERROR: $MIG_DIR not found"
  exit 1
fi

mapfile -t dirs < <(find "$MIG_DIR" -mindepth 1 -maxdepth 1 -type d -printf "%f\n" | sort)

if [[ ${#dirs[@]} -eq 0 ]]; then
  echo "ERROR: No migration folders found in $MIG_DIR"
  exit 1
fi

if [[ ${#dirs[@]} -ne 1 || "${dirs[0]}" != "$EXPECTED" ]]; then
  echo "ERROR: Found unexpected migration folders in prisma/migrations:"
  for d in "${dirs[@]}"; do echo " - $d"; done
  echo
  echo "Prisma will try to apply these in order and a fresh DB install will fail."
  echo "Fix: Remove all other folders so ONLY this remains:"
  echo " - $EXPECTED"
  echo
  echo "This repo keeps old migrations for reference in prisma/migrations_archived/."
  exit 1
fi

echo "OK: prisma/migrations is clean:"
for d in "${dirs[@]}"; do echo " - $d"; done
