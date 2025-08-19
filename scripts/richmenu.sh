#!/usr/bin/env bash
# 必要環境変数: CHANNEL_ACCESS_TOKEN, DEFAULT_IMG, ADVISOR_IMG
set -e

hdr="-H Authorization: Bearer ${CHANNEL_ACCESS_TOKEN} -H Content-Type: application/json"

# 1) 作成
DEF_ID=$(curl -s -X POST $hdr -d @scripts/richmenu-default.json https://api.line.me/v2/bot/richmenu | jq -r '.richMenuId')
ADV_ID=$(curl -s -X POST $hdr -d @scripts/richmenu-advisor.json https://api.line.me/v2/bot/richmenu | jq -r '.richMenuId')

# 2) 画像アップロード
curl -s -X POST -H "Authorization: Bearer ${CHANNEL_ACCESS_TOKEN}" -H "Content-Type: image/png" \
  -T "${DEFAULT_IMG}" "https://api-data.line.me/v2/bot/richmenu/${DEF_ID}/content" >/dev/null
curl -s -X POST -H "Authorization: Bearer ${CHANNEL_ACCESS_TOKEN}" -H "Content-Type: image/png" \
  -T "${ADVISOR_IMG}" "https://api-data.line.me/v2/bot/richmenu/${ADV_ID}/content" >/dev/null

# 3) エイリアス
curl -s -X POST $hdr https://api.line.me/v2/bot/richmenu/alias -d "$(jq -n --arg id "$DEF_ID" '{richMenuAliasId:"default", richMenuId:$id}')"
curl -s -X POST $hdr https://api.line.me/v2/bot/richmenu/alias -d "$(jq -n --arg id "$ADV_ID" '{richMenuAliasId:"advisor_on", richMenuId:$id}')"

# 4) アカウントのデフォルトに default を設定
curl -s -X POST -H "Authorization: Bearer ${CHANNEL_ACCESS_TOKEN}" \
  "https://api.line.me/v2/bot/user/all/richmenu/${DEF_ID}" >/dev/null

echo "DONE"
echo "DEFAULT_RICHMENU_ID=$DEF_ID"
echo "ADVISOR_RICHMENU_ID=$ADV_ID"
