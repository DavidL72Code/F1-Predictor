#!/usr/bin/env bash
# Verifies the correctness/security changes that could not be executed in the
# session where they were written. Run from the repo root:
#     bash scripts/verify_changes.sh
set -uo pipefail
cd "$(dirname "$0")/.."
PY=venv/bin/python
pass=0; fail=0
ok()   { echo "  PASS  $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL  $1"; fail=$((fail+1)); }

echo "=============================================="
echo "1. Backend parses and imports"
echo "=============================================="
if $PY -c "import ast; ast.parse(open('src/api/main.py').read())" 2>/dev/null; then
  ok "src/api/main.py is syntactically valid"
else
  bad "src/api/main.py has a syntax error:"; $PY -c "import ast; ast.parse(open('src/api/main.py').read())"
fi

# Importing is the real test - it runs module-level code (CSV load, training).
if $PY -c "
import sys; sys.path.insert(0,'.')
import src.api.main as m
print('    TRUSTED_PROXY_COUNT      =', m.TRUSTED_PROXY_COUNT)
print('    RATE_LIMITED_PREFIXES    =', m.RATE_LIMITED_PATH_PREFIXES)
print('    CURRENT_SEASON_WEIGHT    =', m.CURRENT_SEASON_WEIGHT)
" 2>/dev/null; then
  ok "module imports and constants are set"
else
  bad "module failed to import - full error:"; $PY -c "import sys; sys.path.insert(0,'.'); import src.api.main" 2>&1 | tail -20
fi

echo
echo "=============================================="
echo "2. X-Forwarded-For parsing (the rate-limit bypass fix)"
echo "=============================================="
$PY - <<'PYEOF'
import sys; sys.path.insert(0,'.')
from src.api.main import _client_ip

class FakeReq:
    def __init__(self, xff, peer="203.0.113.9"):
        self.headers = {"x-forwarded-for": xff} if xff else {}
        self.client = type("C", (), {"host": peer})()

# With one trusted proxy, a client-forged leftmost entry must be ignored.
cases = [
    ("forged.attacker, 198.51.100.7", "198.51.100.7", "forged leftmost entry ignored"),
    ("198.51.100.7",                  "198.51.100.7", "single hop taken as client"),
    ("",                              "203.0.113.9",  "no header falls back to socket peer"),
]
bad = 0
for xff, want, label in cases:
    got = _client_ip(FakeReq(xff))
    flag = "PASS" if got == want else "FAIL"
    if got != want: bad += 1
    print(f"  {flag}  {label}: got {got!r}, want {want!r}")
sys.exit(1 if bad else 0)
PYEOF
[ $? -eq 0 ] && pass=$((pass+1)) || fail=$((fail+1))

echo
echo "=============================================="
echo "3. Rate-limit bucket sweeping (the memory leak fix)"
echo "=============================================="
$PY - <<'PYEOF'
import sys, time; sys.path.insert(0,'.')
import src.api.main as m
from collections import deque

now = time.time()
m._rate_limit_buckets.clear()
# 5000 stale buckets + one live one
for i in range(5000):
    m._rate_limit_buckets[(f"10.0.{i//256}.{i%256}", "races")] = deque([now - 9999])
m._rate_limit_buckets[("live", "races")] = deque([now])

before = len(m._rate_limit_buckets)
m._sweep_rate_limit_buckets(now)
after = len(m._rate_limit_buckets)
live_kept = ("live", "races") in m._rate_limit_buckets
print(f"  buckets {before} -> {after}, live bucket kept: {live_kept}")
sys.exit(0 if after == 1 and live_kept else 1)
PYEOF
[ $? -eq 0 ] && ok "stale buckets swept, active one retained" || bad "sweep did not behave as expected"

echo
echo "=============================================="
echo "4. Vercel proxy allowlist"
echo "=============================================="
node -e '
const { isAllowedPath } = require("./lib/vercelProxy");
const expect = [
  [["health"], true], [["races"], true], [["analytics"], true],
  [["model","stats"], true],
  [["analytics","walk-forward"], true],   // the endpoint that 404d in prod
  [["races","2024","1"], true],
  [["analytics",".."], false], [["admin"], false],
  [["races","abcd","1"], false], [[], false],
];
let bad = 0;
for (const [p, want] of expect) {
  const got = isAllowedPath(p);
  if (got !== want) bad++;
  console.log(`  ${got===want?"PASS":"FAIL"}  /${p.join("/")} -> ${got} (want ${want})`);
}
process.exit(bad ? 1 : 0);
' && ok "proxy allowlist correct" || bad "proxy allowlist wrong"

echo
echo "=============================================="
echo "5. .env is ignored, .env.example still tracked"
echo "=============================================="
git check-ignore -q frontend/.env      && ok "frontend/.env ignored"      || bad "frontend/.env NOT ignored"
git check-ignore -q .env               && ok ".env ignored"               || bad ".env NOT ignored"
git check-ignore -q frontend/.env.example && bad ".env.example wrongly ignored" || ok ".env.example still tracked"

echo
echo "=============================================="
echo "RESULT: $pass passed, $fail failed"
echo "=============================================="
[ "$fail" -eq 0 ] || exit 1
