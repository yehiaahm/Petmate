#!/usr/bin/env bash
#
# run-all.sh — starts the whole PetMate platform locally: the web app and
# the background worker (which sends deliveries, releases escrow, settles
# ad campaigns, qualifies referrals, and everything else in RECURRING_JOBS).
#
# Usage:
#   ./run-all.sh          # normal dev server (fast reloads)
#   ./run-all.sh --build  # production build + start (closer to real deploy)
#
# Stop everything with Ctrl+C.

set -euo pipefail
cd "$(dirname "$0")"

MODE="dev"
if [[ "${1:-}" == "--build" ]]; then
  MODE="build"
fi

echo "== PetMate: run-all =="

# ---------------------------------------------------------------------------
# 1. Dependencies
# ---------------------------------------------------------------------------
if [[ ! -d node_modules ]]; then
  echo "-> Installing dependencies (npm install)..."
  npm install
fi

# ---------------------------------------------------------------------------
# 2. Environment
# ---------------------------------------------------------------------------
if [[ ! -f .env ]]; then
  echo "-> No .env found, copying .env.example (edit it if you need real keys)"
  cp .env.example .env
fi

# ---------------------------------------------------------------------------
# 3. Database
# ---------------------------------------------------------------------------
echo "-> Generating the Prisma client..."
npx prisma generate >/dev/null

if [[ ! -f prisma/dev.db ]]; then
  echo "-> No local database found, creating it and applying the schema..."
  npm run db:push
  echo "-> Seeding demo data (pets, listings, clinics, a demo account)..."
  npm run db:seed
else
  echo "-> Applying any pending schema changes to prisma/dev.db..."
  npm run db:push
fi

# ---------------------------------------------------------------------------
# 4. Free port 3000 if something is already listening on it
# ---------------------------------------------------------------------------
if command -v fuser >/dev/null 2>&1; then
  fuser -k 3000/tcp >/dev/null 2>&1 || true
fi

# ---------------------------------------------------------------------------
# 5. Start the web app + the background worker together
# ---------------------------------------------------------------------------
PIDS=()
CLEANED_UP=0
cleanup() {
  [[ "$CLEANED_UP" == "1" ]] && return
  CLEANED_UP=1
  echo ""
  echo "-> Stopping everything..."
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" >/dev/null 2>&1 || true
  done
  wait >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

if [[ "$MODE" == "build" ]]; then
  echo "-> Building for production..."
  npm run build
  echo "-> Starting the web app (npm start) on http://localhost:3000 ..."
  npm run start &
  PIDS+=($!)
else
  echo "-> Starting the web app (npm run dev) on http://localhost:3000 ..."
  npm run dev &
  PIDS+=($!)
fi

echo "-> Starting the background worker (npm run worker)..."
npm run worker &
PIDS+=($!)

sleep 2
echo ""
echo "================================================================"
echo " PetMate is running."
echo ""
echo "   Site:            http://localhost:3000"
echo "   Arabic site:      http://localhost:3000/ar"
echo "   Admin console:    http://localhost:3000/admin"
echo "   Dev mailbox:       http://localhost:3000/dev/mailbox  (outbox emails/SMS/WhatsApp)"
echo ""
echo "   Demo login:       nour@demo.petmate.invalid / DemoPassword123!"
echo "   Demo seller:      pawsupply@demo.petmate.invalid / DemoPassword123!"
echo ""
echo "   Press Ctrl+C to stop the web app and the worker."
echo "================================================================"
echo ""

wait
