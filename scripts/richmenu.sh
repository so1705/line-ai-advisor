#!/usr/bin/env bash
# 必要: CHANNEL_ACCESS_TOKEN を事前に export
# 画像: assets/richmenu/default.png, assets/richmenu/advisor.png
set -e

DEFAULT_IMG="./assets/richmenu/default.png"
ADVISOR_IMG="./assets/richmenu/advisor.png"
AUTHH="-H Authorization: Bearer ${CHANNEL_ACCESS_TOKEN}"

# 1) 作成
DEF_ID=$(curl -s -X POST $AUTHH -H 'Content-Type: application/json' \
  -d @scripts/richmenu-default.json https://api.line.me/v2/bot/richmenu | jq -r '.richMenuId')

ADV_ID=$(curl -s -X POST $AUTHH -H 'Content-Type: application/json' \
  -d @scripts/richmenu-advisor.json https://api.line.me/v2/bot/richmenu | jq -r '.richMenuId')

echo "DEFAULT richMenuId: $DEF_ID"
echo "ADVISOR  richMenuId: $ADV_ID"

# 2) 画像アップロード
curl -s -X POST $AUTHH -H 'Content-Type: image/png' \
  -T "$DEFAULT_IMG" "https://api-data.line.me/v2/bot/richmenu/${DEF_ID}/content" >/dev/null

curl -s -X POST $AUTHH -H 'Content-Type: image/png' \
  -T "$ADVISOR_IMG" "https://api-data.line.me/v2/bot/richmenu/${ADV_ID}/content" >/dev/null

# 3) エイリアス
curl -s -X POST $AUTHH -H 'Content-Type: application/json' \
  -d "{\"richMenuAliasId\":\"default\",\"richMenuId\":\"${DEF_ID}\"}" \
  https://api.line.me/v2/bot/richmenu/alias >/dev/null

curl -s -X POST $AUTHH -H 'Content-Type: application/json' \
  -d "{\"richMenuAliasId\":\"advisor_on\",\"richMenuId\":\"${ADV_ID}\"}" \
  https://api.line.me/v2/bot/richmenu/alias >/dev/null

# 4) アカウントのデフォルトを default に
curl -s -X POST $AUTHH "https://api.line.me/v2/bot/user/all/richmenu/${DEF_ID}" >/dev/null

echo "DONE"
echo "Set Vercel env: ADVISOR_RICHMENU_ID=${ADV_ID}"
