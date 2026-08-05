#!/bin/zsh
# ═══════════════════════════════════════════════════════════════════
#  dev.sh — DDJTalks Full Local Dev Stack
#  Usage:  ./MacReceiver/dev.sh [--seed]
#
#  Starts:
#    1. Firebase Emulator  (Firestore → localhost:8080, UI → localhost:4000)
#    2. FastAPI Backend    (→ localhost:8000, uses emulator Firestore)
#    3. Vite Dev Server   (→ localhost:5173, uses emulator Firestore)
#
#  Options:
#    --seed   Export production Firestore data before starting (one-time)
# ═══════════════════════════════════════════════════════════════════

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEB_DIR="$SCRIPT_DIR/web-ui"
SERVER_DIR="$SCRIPT_DIR/server"
EMULATOR_DATA_DIR="$SCRIPT_DIR/emulator-data"

# ── Colour helpers ──────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo "${GREEN}[dev]${NC} $1"; }
warn()  { echo "${YELLOW}[dev]${NC} $1"; }
error() { echo "${RED}[dev]${NC} $1"; exit 1; }

# ── Check Java ──────────────────────────────────────────────────
if ! java -version &>/dev/null 2>&1; then
  error "Java not found. Install with: brew install --cask temurin\nThen re-run this script."
fi

# ── Seed option: export production data into emulator-data/ ─────
if [[ "$1" == "--seed" ]]; then
  warn "Exporting production Firestore data → $EMULATOR_DATA_DIR"
  warn "This reads from production and may use ~500 Firestore reads."
  cd "$WEB_DIR"
  npx firebase emulators:export "$EMULATOR_DATA_DIR" --project fir-c028b
  info "Seed complete! Data saved to $EMULATOR_DATA_DIR"
  info "Re-run without --seed to start the stack."
  exit 0
fi

# ── Cleanup function: kill all child processes on Ctrl+C ────────
cleanup() {
  warn "Shutting down all local services..."
  kill $EMULATOR_PID $BACKEND_PID $VITE_PID 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

# ── 1. Firebase Emulator ────────────────────────────────────────
info "Starting Firebase Emulator (Firestore:8080, UI:4000)..."
cd "$WEB_DIR"
IMPORT_FLAG=""
if [ -d "$EMULATOR_DATA_DIR" ]; then
  info "Loading emulator data from $EMULATOR_DATA_DIR"
  IMPORT_FLAG="--import $EMULATOR_DATA_DIR --export-on-exit $EMULATOR_DATA_DIR"
else
  warn "No emulator-data/ found. Starting empty. Run with --seed first to load production data."
fi
npx firebase emulators:start --only firestore $IMPORT_FLAG &
EMULATOR_PID=$!

# Wait for emulator to be ready
sleep 5
info "✓ Firestore emulator running on localhost:8080"
info "✓ Emulator UI at http://localhost:4000"

# ── 2. FastAPI Backend ──────────────────────────────────────────
info "Starting FastAPI backend (localhost:8000) → emulator Firestore..."
cd "$SERVER_DIR"
# Source emulator env so Python admin SDK hits localhost:8080
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
export GCLOUD_PROJECT=fir-c028b
source venv/bin/activate 2>/dev/null || warn "No venv found, using system Python"
uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!
sleep 2
info "✓ Backend running on http://localhost:8000"

# ── 3. Vite Dev Server ──────────────────────────────────────────
info "Starting Vite dev server (localhost:5173) → emulator Firestore..."
cd "$WEB_DIR"
npm run dev &
VITE_PID=$!
sleep 2

# ── Summary ─────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
info "✅ Full local stack running:"
info "   Frontend:       http://localhost:5173"
info "   Backend API:    http://localhost:8000/docs"
info "   Firestore UI:   http://localhost:4000"
info "   Firestore:      localhost:8080 (emulator)"
echo "═══════════════════════════════════════════════════"
echo ""
warn "Press Ctrl+C to stop all services."

# Keep script alive until Ctrl+C
wait
