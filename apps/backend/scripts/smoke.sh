#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-https://feedbacker-backend-34nw.onrender.com}"ORIGIN="${ORIGIN:-https://app.lovable.dev}"
SHOP="${SHOP:-shop_001}"
SINCE="${SINCE:-1970-01-01T00:00:00Z}"

say(){ printf "\n\033[1;36m==> %s\033[0m\n" "$*"; }
fail(){ echo -e "\n\033[1;31m✗ $*\033[0m"; exit 1; }
ok(){   echo -e "\033[1;32m✓ $*\033[0m"; }

say "BASE: $BASE"
say "ORIGIN: $ORIGIN"

# Ждём /health (до 60с)
say "Жду старта /health…"
for i in {1..60}; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE/health" || true)
  [ "$code" = "200" ] && { ok "/health отвечает"; break; }
  sleep 1
  [ "$i" = "60" ] && fail "/health не отвечает (последний код: $code)"
done

# Preflight OPTIONS → 204
say "Preflight (OPTIONS /health)…"
pre=$(curl -sS -o /dev/null -w "%{http_code}" -X OPTIONS \
  -H "Origin: $ORIGIN" \
  -H "Access-Control-Request-Method: GET" \
  "$BASE/health" || true)
[ "$pre" = "204" ] || fail "Ожидал 204, получил $pre"
ok "Preflight OK (204)"

# GET /health с Origin → 200 + ACAO
say "GET /health с Origin + заголовки…"
hdrs=$(curl -sS -D - -o /dev/null -H "Origin: $ORIGIN" "$BASE/health")
code=$(printf "%s" "$hdrs" | awk 'NR==1{print $2}')
acao=$(printf "%s" "$hdrs" | tr -d '\r' | awk 'BEGIN{IGNORECASE=1}/^Access-Control-Allow-Origin:/{print $2}')
[ "$code" = "200" ] || fail "GET /health: ожидал 200, получил $code"
if [ "$acao" != "$ORIGIN" ] && [ "$acao" != "*" ]; then
  echo "$hdrs" | head -n 20
  fail "Нет корректного Access-Control-Allow-Origin (получил: '$acao')"
fi
ok "GET /health OK (200, ACAO: $acao)"

# Список отзывов (может быть пусто — это норм)
say "GET /feedback/$SHOP?since=$SINCE&limit=1…"
code_list=$(curl -sS -o /dev/null -w "%{http_code}" \
  "$BASE/feedback/$SHOP?since=$SINCE&limit=1" || true)
[ "$code_list" = "200" ] || fail "GET /feedback: ожидал 200, получил $code_list"
ok "GET /feedback OK (200)"

say "ВСЁ ОК ✅ — можно подключать к Lovable"
