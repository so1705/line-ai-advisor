#!/usr/bin/env bash
set -euo pipefail

if [ -z "${CHANNEL_ACCESS_TOKEN:-}" ]; then
  echo "ERROR: CHANNEL_ACCESS_TOKEN not set"; exit 1
fi

DEFAULT_IMG="./assets/richmenu/default.png"
ADVISOR_IMG="./assets/richmenu/advisor.png"

# ← ここがポイント：配列で保持して展開時も配列のまま渡す
AUTHH=(-H "Authorization: Bearer ${CHANNEL_ACCESS_TOKEN}")

json_post () {  # 小ヘルパー
  curl -s -X POST "${AUTHH[@]}" -H 'Content-Type: application/json' -d @"$1" "$2"
}

echo "== Create default richmenu =="
DEF_RESP=$(json_post scripts/richmenu-default.json https://api.line.me/v2/bot/richmenu)
echo "RESP(default): $DEF_RESP"
DEF_ID=$(echo "$DEF_RESP" | sed -n 's/.*"richMenuId":"\([^"]*\)".*/\1/p')

echo "== Create advisor richmenu =="
ADV_RESP=$(json_post scripts/richmenu-advisor.json https://api.line.me/v2/bot/richmenu)
echo "RESP(advisor): $ADV_RESP"
ADV_ID=$(echo "$ADV_RESP" | sed -n 's/.*"richMenuId":"\([^"]*\)".*/\1/p')

if [ -z "$DEF_ID" ] || [ -z "$ADV_ID" ]; then
  echo "ERROR: richmenu create failed. See RESP above."; exit 1
fi

echo "DEFAULT richMenuId: $DEF_ID"
echo "ADVISOR  richMenuId: $ADV_ID"

echo "== Upload images =="
curl -s -X POST "${AUTHH[@]}" -H 'Content-Type: image/png' \
  -T "$DEFAULT_IMG" "https://api-data.line.me/v2/bot/richmenu/${DEF_ID}/content" | cat
curl -s -X POST "${AUTHH[@]}" -H 'Content-Type: image/png' \
  -T "$ADVISOR_IMG" "https://api-data.line.me/v2/bot/richmenu/${ADV_ID}/content" | cat

echo "== Create aliases =="
curl -s -X POST "${AUTHH[@]}" -H 'Content-Type: application/json' \
  -d "{\"richMenuAliasId\":\"default\",\"richMenuId\":\"${DEF_ID}\"}" \
  https://api.line.me/v2/bot/richmenu/alias | cat
curl -s -X POST "${AUTHH[@]}" -H 'Content-Type: application/json' \
  -d "{\"richMenuAliasId\":\"advisor_on\",\"richMenuId\":\"${ADV_ID}\"}" \
  https://api.line.me/v2/bot/richmenu/alias | cat

echo "== Set default richmenu =="
curl -s -X POST "${AUTHH[@]}" \
  "https://api.line.me/v2/bot/user/all/richmenu/${DEF_ID}" | cat

echo
echo "DONE"
echo "Set Vercel env: ADVISOR_RICHMENU_ID=${ADV_ID}"
