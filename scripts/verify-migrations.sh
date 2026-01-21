#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MIG_DIR="$ROOT_DIR/prisma/migrations"
EXPECTED_FIRST="20260112000000_init"

if [[ ! -d "$MIG_DIR" ]]; then
  echo "ERROR: $MIG_DIR not found"
  exit 1
fi

mapfile -t dirs < <(find "$MIG_DIR" -mindepth 1 -maxdepth 1 -type d -printf "%f\n" | sort)

if [[ ${#dirs[@]} -eq 0 ]]; then
  echo "ERROR: No migration folders found in $MIG_DIR"
  exit 1
fi

if [[ "${dirs[0]}" != "$EXPECTED_FIRST" ]]; then
  echo "ERROR: First migration must be $EXPECTED_FIRST"
  echo "Found: ${dirs[0]}"
  exit 1
fi

echo "OK: prisma/migrations folders (applied in order):"
for d in "${dirs[@]}"; do echo " - $d"; done
