#!/usr/bin/env bash
# End-to-end smoke test of the production Docker image.
# Builds the image, starts it on an empty volume in production mode, and checks:
# bootstrap admin, no demo data, forced password change, invoice creation,
# PDF rendering with the bundled Chromium, and an online backup.
#   bash deploy/smoke-test.sh
set -euo pipefail

IMAGE=apex-finance:smoke
NAME=apex-smoke
PORT=3099
BASE="http://127.0.0.1:${PORT}"
ADMIN_EMAIL=smoke@example.com
BOOT_PW="smoke-bootstrap-password-1"
NEW_PW="smoke-new-password-12345"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
fail() { echo "FAIL: $*"; docker logs "$NAME" 2>&1 | tail -40 || true; exit 1; }
pass() { echo "PASS: $*"; }

docker build -t "$IMAGE" .
cleanup
docker run -d --name "$NAME" -p "${PORT}:3000" \
  -e JWT_SECRET="smoke-test-secret-0123456789abcdefghijklmnop" \
  -e ADMIN_EMAIL="$ADMIN_EMAIL" -e ADMIN_PASSWORD="$BOOT_PW" \
  -e ADMIN_COMPANY_NAME="Smoke Test Ltd" -e ADMIN_COMPANY_CURRENCY=USD \
  "$IMAGE" >/dev/null

for i in $(seq 1 45); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$NAME" 2>/dev/null || echo starting)
  [ "$status" = healthy ] && break
  [ "$i" = 45 ] && fail "container never became healthy (last status: $status)"
  sleep 2
done
pass "container healthy"

[ "$(curl -fsS "$BASE/api/public-config" | jq -r .demoMode)" = false ] || fail "demo mode is on in production"
pass "demo mode off"

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"admin@apexfin.com","password":"admin123"}')
[ "$code" = 401 ] || fail "demo account login returned $code"
pass "demo accounts absent"

login=$(curl -fsS -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$BOOT_PW\"}")
TOKEN=$(echo "$login" | jq -r .token)
[ "$(echo "$login" | jq -r .user.mustChangePassword)" = true ] || fail "bootstrap admin not forced to change password"
pass "bootstrap admin can log in and must change password"

curl -fsS -X POST "$BASE/api/auth/change-password" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"currentPassword\":\"$BOOT_PW\",\"newPassword\":\"$NEW_PW\"}" >/dev/null || fail "password change"
pass "password changed"

AUTH=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')
CLIENT_ID=$(curl -fsS -X POST "$BASE/api/clients" "${AUTH[@]}" -d '{"company_name":"Smoke Client","preferred_currency":"USD","email":"client@example.com"}' | jq -r .id)
TODAY=$(date -u +%F); DUE=$(date -u -d '+30 days' +%F)
INVOICE_ID=$(curl -fsS -X POST "$BASE/api/invoices" "${AUTH[@]}" -d "{\"client_id\":\"$CLIENT_ID\",\"currency\":\"USD\",\"issue_date\":\"$TODAY\",\"due_date\":\"$DUE\",\"items\":[{\"description\":\"Consulting\",\"quantity\":2,\"unit_price\":150}]}" | jq -r .id)
[ -n "$INVOICE_ID" ] && [ "$INVOICE_ID" != null ] || fail "invoice creation"
pass "client and invoice created"

curl -fsS "$BASE/api/invoices/$INVOICE_ID/pdf" -H "Authorization: Bearer $TOKEN" -o /tmp/smoke.pdf || fail "PDF request"
head -c 4 /tmp/smoke.pdf | grep -q '%PDF' || fail "PDF output is not a PDF"
[ "$(stat -c %s /tmp/smoke.pdf)" -gt 5000 ] || fail "PDF suspiciously small"
pass "invoice PDF rendered by bundled Chromium ($(stat -c %s /tmp/smoke.pdf) bytes)"

docker exec "$NAME" npm run -s backup | grep -q 'integrity ok' || fail "backup"
pass "online backup written"

echo "All Docker smoke tests passed."
