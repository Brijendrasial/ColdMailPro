#!/usr/bin/env bash
set -euo pipefail
FILE="app/api/domains/provision-mailstack/route.ts"
if [[ ! -f "$FILE" ]]; then
  echo "Missing $FILE" >&2
  exit 1
fi
if grep -n "prisma\.job\.create" "$FILE"; then
  echo "\nERROR: prisma.job.create still present (this will 500 if Prisma client missing job delegate)." >&2
  exit 2
fi
echo "OK: provision-mailstack route does not call prisma.job.create" 
