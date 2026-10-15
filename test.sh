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

# ---- browser probe (shared gate for steps 3-4) ----
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

# ---- 2. syntax (no browser needed) ----
step "syntax — tests/jscheck.py"
if python3 tests/jscheck.py; then
  pass "jscheck (new shell + all legacy games)"
else
  fail "jscheck"
  echo "Stopped at first failure." >&2
  printf '\nResult: %d passed, %d failed, %d skipped\n' "$PASS" "$FAIL" "$SKIPPED"
  exit 1
fi

# ---- 3. secrets (no browser needed) ----
step "secrets — tests/secrets_test.py"
if python3 tests/secrets_test.py; then
  pass "secrets_test"
else
  fail "secrets_test"
  echo "Stopped at first failure." >&2
  printf '\nResult: %d passed, %d failed, %d skipped\n' "$PASS" "$FAIL" "$SKIPPED"
  exit 1
fi

# ---- 4. bun lockfile (no browser needed) ----
step "bun lockfile — tests/lockfile_test.py"
if python3 tests/lockfile_test.py; then
  pass "lockfile_test"
else
  fail "lockfile_test"
  echo "Stopped at first failure." >&2
  printf '\nResult: %d passed, %d failed, %d skipped\n' "$PASS" "$FAIL" "$SKIPPED"
  exit 1
fi

# ---- 5. record sentences (browser) ----
step "record sentences — tests/record_test.py"
if [ "$BROWSER_OK" = "1" ]; then
  if python3 tests/record_test.py; then
    pass "record_test"
  else
    fail "record_test"
    echo "Stopped at first failure." >&2
    printf '\nResult: %d passed, %d failed, %d skipped\n' "$PASS" "$FAIL" "$SKIPPED"
    exit 1
  fi
else
  if [ "$SKIP_BROWSER" = "1" ]; then
    skip "record_test ($BROWSER_WHY)"
  else
    fail "record_test (no browser: $BROWSER_WHY)"
    echo "Tip: re-run with --skip-browser for syntax-only checks." >&2
    printf '\nResult: %d passed, %d failed, %d skipped\n' "$PASS" "$FAIL" "$SKIPPED"
    exit 1
  fi
fi

# ---- 6. legacy record sentences (browser) ----
step "legacy record sentences — tests/record_legacy_test.py"
if [ "$BROWSER_OK" = "1" ]; then
  if python3 tests/record_legacy_test.py; then
    pass "record_legacy_test"
  else
    fail "record_legacy_test"
    echo "Stopped at first failure." >&2
    printf '\nResult: %d passed, %d failed, %d skipped\n' "$PASS" "$FAIL" "$SKIPPED"
    exit 1
  fi
else
  if [ "$SKIP_BROWSER" = "1" ]; then
    skip "record_legacy_test ($BROWSER_WHY)"
  else
    fail "record_legacy_test (no browser: $BROWSER_WHY)"
    echo "Tip: re-run with --skip-browser for syntax-only checks." >&2
    printf '\nResult: %d passed, %d failed, %d skipped\n' "$PASS" "$FAIL" "$SKIPPED"
    exit 1
  fi
fi

# ---- 7. module registry (browser) ----
step "module registry — tests/module_registry_test.py"
if [ "$BROWSER_OK" = "1" ]; then
  if python3 tests/module_registry_test.py; then
    pass "module_registry_test"
  else
    fail "module_registry_test"
    echo "Stopped at first failure." >&2
    printf '\nResult: %d passed, %d failed, %d skipped\n' "$PASS" "$FAIL" "$SKIPPED"
    exit 1
  fi
else
  if [ "$SKIP_BROWSER" = "1" ]; then
    skip "module_registry_test ($BROWSER_WHY)"
  else
    fail "module_registry_test (no browser: $BROWSER_WHY)"
    echo "Tip: re-run with --skip-browser for syntax-only checks." >&2
    printf '\nResult: %d passed, %d failed, %d skipped\n' "$PASS" "$FAIL" "$SKIPPED"
    exit 1
  fi
fi

# ---- 8. dot return rules (browser) ----
step "dot return rules — tests/dotreturn_test.py"
if [ "$BROWSER_OK" = "1" ]; then
  if python3 tests/dotreturn_test.py; then
    pass "dotreturn_test"
  else
    fail "dotreturn_test"
    echo "Stopped at first failure." >&2
    printf '\nResult: %d passed, %d failed, %d skipped\n' "$PASS" "$FAIL" "$SKIPPED"
    exit 1
  fi
else
  if [ "$SKIP_BROWSER" = "1" ]; then
    skip "dotreturn_test ($BROWSER_WHY)"
  else
    fail "dotreturn_test (no browser: $BROWSER_WHY)"
    echo "Tip: re-run with --skip-browser for syntax-only checks." >&2
    printf '\nResult: %d passed, %d failed, %d skipped\n' "$PASS" "$FAIL" "$SKIPPED"
    exit 1
  fi
fi

# ---- 9. dot return play test (browser) ----
step "dot return play test — tests/dotreturn_play.py"
if [ "$BROWSER_OK" = "1" ]; then
  if python3 tests/dotreturn_play.py; then
    pass "dotreturn_play"
  else
    fail "dotreturn_play"
    echo "Stopped at first failure." >&2
    printf '\nResult: %d passed, %d failed, %d skipped\n' "$PASS" "$FAIL" "$SKIPPED"
    exit 1
  fi
else
  if [ "$SKIP_BROWSER" = "1" ]; then
    skip "dotreturn_play ($BROWSER_WHY)"
  else
    fail "dotreturn_play (no browser: $BROWSER_WHY)"
    echo "Tip: re-run with --skip-browser for syntax-only checks." >&2
    printf '\nResult: %d passed, %d failed, %d skipped\n' "$PASS" "$FAIL" "$SKIPPED"
    exit 1
  fi
fi

# ---- 10. dot return paint test (browser) ----
step "dot return paint test — tests/dotreturn_paint_test.py"
if [ "$BROWSER_OK" = "1" ]; then
  if python3 tests/dotreturn_paint_test.py; then
    pass "dotreturn_paint_test"
  else
    fail "dotreturn_paint_test"
    echo "Stopped at first failure." >&2
    printf '\nResult: %d passed, %d failed, %d skipped\n' "$PASS" "$FAIL" "$SKIPPED"
    exit 1
  fi
else
  if [ "$SKIP_BROWSER" = "1" ]; then
    skip "dotreturn_paint_test ($BROWSER_WHY)"
  else
    fail "dotreturn_paint_test (no browser: $BROWSER_WHY)"
    echo "Tip: re-run with --skip-browser for syntax-only checks." >&2
    printf '\nResult: %d passed, %d failed, %d skipped\n' "$PASS" "$FAIL" "$SKIPPED"
    exit 1
  fi
fi

# ---- 11. dot return net test (browser) ----
step "dot return net test — tests/dotreturn_net.py"
if [ "$BROWSER_OK" = "1" ]; then
  if python3 tests/dotreturn_net.py; then
    pass "dotreturn_net"
  else
    fail "dotreturn_net"
    echo "Stopped at first failure." >&2
    printf '\nResult: %d passed, %d failed, %d skipped\n' "$PASS" "$FAIL" "$SKIPPED"
    exit 1
  fi
else
  if [ "$SKIP_BROWSER" = "1" ]; then
    skip "dotreturn_net ($BROWSER_WHY)"
  else
    fail "dotreturn_net (no browser: $BROWSER_WHY)"
    echo "Tip: re-run with --skip-browser for syntax-only checks." >&2
    printf '\nResult: %d passed, %d failed, %d skipped\n' "$PASS" "$FAIL" "$SKIPPED"
    exit 1
  fi
fi

# ---- 12. music bridge rules (browser) ----
step "music bridge rules — tests/musicbridge_test.py"
if [ "$BROWSER_OK" = "1" ]; then
  if python3 tests/musicbridge_test.py; then
    pass "musicbridge_test"
  else
    fail "musicbridge_test"
    echo "Stopped at first failure." >&2
    printf '\nResult: %d passed, %d failed, %d skipped\n' "$PASS" "$FAIL" "$SKIPPED"
    exit 1
  fi
else
  if [ "$SKIP_BROWSER" = "1" ]; then
    skip "musicbridge_test ($BROWSER_WHY)"
  else
    fail "musicbridge_test (no browser: $BROWSER_WHY)"
    echo "Tip: re-run with --skip-browser for syntax-only checks." >&2
    printf '\nResult: %d passed, %d failed, %d skipped\n' "$PASS" "$FAIL" "$SKIPPED"
    exit 1
  fi
fi

# ---- 13. chess rules (browser) ----
step "chess rules — tests/chess_rules.py"
if [ "$BROWSER_OK" = "1" ]; then
  if python3 tests/chess_rules.py; then
    pass "chess_rules"
  else
    fail "chess_rules"
    echo "Stopped at first failure." >&2
    printf '\nResult: %d passed, %d failed, %d skipped\n' "$PASS" "$FAIL" "$SKIPPED"
    exit 1
  fi
else
  if [ "$SKIP_BROWSER" = "1" ]; then
    skip "chess_rules ($BROWSER_WHY)"
  else
    fail "chess_rules (no browser: $BROWSER_WHY)"
    echo "Tip: re-run with --skip-browser for syntax-only checks." >&2
    printf '\nResult: %d passed, %d failed, %d skipped\n' "$PASS" "$FAIL" "$SKIPPED"
    exit 1
  fi
fi

# ---- 14. the 96 game play test (browser) ----
step "the 96 game play test — tests/t96_play.py"
if [ "$BROWSER_OK" = "1" ]; then
  if python3 tests/t96_play.py; then
    pass "t96_play"
  else
    fail "t96_play"
    echo "Stopped at first failure." >&2
    printf '\nResult: %d passed, %d failed, %d skipped\n' "$PASS" "$FAIL" "$SKIPPED"
    exit 1
  fi
else
  if [ "$SKIP_BROWSER" = "1" ]; then
    skip "t96_play ($BROWSER_WHY)"
  else
    fail "t96_play (no browser: $BROWSER_WHY)"
    echo "Tip: re-run with --skip-browser for syntax-only checks." >&2
    printf '\nResult: %d passed, %d failed, %d skipped\n' "$PASS" "$FAIL" "$SKIPPED"
    exit 1
  fi
fi

printf '\nALL GREEN (%d passed, %d skipped)\n' "$PASS" "$SKIPPED"
exit 0
