#!/usr/bin/env bash
# BubHub quick checks — one command, fail-fast.
#
#   ./test.sh                # syntax + secrets + lockfile + record sentences + game rules
#   ./test.sh --skip-browser # syntax only (fully offline, no Chromium needed)
#
# Exit codes: 0 = all green, 1 = a test failed, 2 = environment problem
# (missing python3 / esprima). Browser-dependent tests need Playwright +
# Chromium; without them they FAIL loudly, or SKIP with --skip-browser.
#
# Suites live in the two tables near the bottom: OFFLINE always runs, BROWSER
# gates on Chromium. Adding or removing a suite is one line, not a copy-pasted
# block. The runner keeps the old behaviour: first failure stops the run.
#
# Deliberately NOT included: tests/chess_play.py targets the OLD shell via
# file:// and the new ES-module shell needs HTTP — porting it is a separate
# task.
set -u

SKIP_BROWSER=0
for arg in "$@"; do
  case "$arg" in
    --skip-browser) SKIP_BROWSER=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0 ;;
    *) echo "Unknown option: $arg (try --skip-browser)" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")"

PASS=0
FAIL=0
SKIPPED=0

step() { printf '\n=== %s ===\n' "$1"; }
pass() { PASS=$((PASS + 1)); echo "PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "FAIL: $1"; }
skip() { SKIPPED=$((SKIPPED + 1)); echo "SKIP: $1"; }

result() { printf '\nResult: %d passed, %d failed, %d skipped\n' "$PASS" "$FAIL" "$SKIPPED"; }

bail() {
  echo "Stopped at first failure." >&2
  result
  exit 1
}

# Offline suite: always runs; needs only python3 + esprima.
run_offline() {
  local name="$1" script="$2"
  step "$name — tests/$script"
  if python3 "tests/$script"; then pass "$script"; else fail "$script"; bail; fi
}

# Browser suite: loud failure without Chromium, SKIP with --skip-browser.
# A .mjs entry runs under node (it needs no browser), everything else python3.
run_browser() {
  local name="$1" script="$2"
  step "$name — tests/$script"
  if [ "$BROWSER_OK" = "1" ]; then
    local rc=0
    case "$script" in
      *.mjs) node "tests/$script" || rc=$? ;;
      *) python3 "tests/$script" || rc=$? ;;
    esac
    if [ "$rc" -eq 0 ]; then pass "$script"; else fail "$script"; bail; fi
  elif [ "$SKIP_BROWSER" = "1" ]; then
    skip "$script ($BROWSER_WHY)"
  else
    fail "$script (no browser: $BROWSER_WHY)"
    echo "Tip: re-run with --skip-browser for syntax-only checks." >&2
    bail
  fi
}

# ---- 1. preflight ----
step "preflight"
if ! command -v python3 >/dev/null 2>&1; then
  echo "FAIL: python3 not found on PATH" >&2
  exit 2
fi
if ! python3 -c "import esprima" 2>/dev/null; then
  echo "FAIL: python package 'esprima' missing — run: pip install esprima" >&2
  exit 2
fi
echo "python3 + esprima ok"

# ---- browser probe (shared gate for every browser suite) ----
BROWSER_OK=0
BROWSER_WHY=""
if [ "$SKIP_BROWSER" = "1" ]; then
  BROWSER_WHY="--skip-browser given"
elif ! python3 -c "from playwright.sync_api import sync_playwright" 2>/dev/null; then
  BROWSER_WHY="playwright pip package missing — run: pip install playwright && playwright install chromium"
elif ! python3 - <<'EOF' 2>/dev/null; then
import sys
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        b.close()
except Exception as e:
    print(str(e)[:200])
    sys.exit(1)
EOF
  BROWSER_WHY="headless Chromium launch failed — run: playwright install chromium"
else
  BROWSER_OK=1
fi
if [ "$BROWSER_OK" = "1" ]; then
  echo "browser probe ok (playwright + chromium launch)"
else
  echo "browser probe: unavailable ($BROWSER_WHY)"
fi

# ---- suite tables ----
# name|script  — order is the run order.
OFFLINE_SUITES=(
  "syntax|jscheck.py"
  "secrets|secrets_test.py"
  "bun lockfile|lockfile_test.py"
  "kick/ghost|kick_ghost_test.py"
)

BROWSER_SUITES=(
  "record sentences|record_test.py"
  "legacy record sentences|record_legacy_test.py"
  "record durability|record_durability_test.py"
  "solo host|solo_host_test.py"
  "module registry|module_registry_test.py"
  "dot return rules|dotreturn_test.py"
  "dot return play test|dotreturn_play.py"
  "dot return paint test|dotreturn_paint_test.py"
  "dot return net test|dotreturn_net.py"
  "dot return round ending|dotreturn_finish_test.py"
  "hook rules|hook_test.py"
  "hook play test|hook_play.py"
  "presence|presence_test.py"
  "chess rules|chess_rules.py"
  "chess captures|chess_captures.py"
  "chess capture play test|chess_capture_play.py"
  "the 96 game play test|t96_play.py"
  "eggs|eggs_test.py"
  # A node harness, not python: minigo_test.mjs drives the shipped module and
  # the MCTS bot with no browser. It was in this table being run by python3,
  # which could only ever SyntaxError — a suite that has never once passed.
  "minigo|minigo_test.mjs"
)

for entry in "${OFFLINE_SUITES[@]}"; do
  run_offline "${entry%%|*}" "${entry##*|}"
done
for entry in "${BROWSER_SUITES[@]}"; do
  run_browser "${entry%%|*}" "${entry##*|}"
done

printf '\nALL GREEN (%d passed, %d skipped)\n' "$PASS" "$SKIPPED"
exit 0
