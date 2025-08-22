#!/usr/bin/env bash
set -euo pipefail

# === 必須: 環境変数 ===
: "${CHANNEL_ACCESS_TOKEN:?Set CHANNEL_ACCESS_TOKEN first}"

# === 引数 ===
ALIAS=""
JSON_PATH=""
IMAGE_PATH=""
CTYPE="image/jpeg"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --alias) ALIAS="$2"; shift 2 ;;
    --json) JSON_PATH="$2"; shift 2 ;;
    --image) IMAGE_PATH="$2"; shift 2 ;;
    --type) CTYPE="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -z "$ALIAS" || -z "$JSON_PATH" || -z "$IMAGE_PATH" ]]; then
  echo "Usage: $0 --alias <default|advisor_on> --json <richmenu.json> --image <path> [--type image/jpeg|image/png]"
  exit 1
fi

if [[ ! -f "$JSON_PATH" ]]; then
  echo "JSON not found: $JSON_PATH"; exit 1
fi
if [[ ! -f "$IMAGE_PATH" ]]; then
  echo "Image not found: $IMAGE_PATH"; exit 1
fi

API="https://api.line.me"
APID="https://api-data.line.me"

echo "== Step 0: alias 現状確認 =="
ALIAS_LIST_JSON=$(curl -s -H "Authorization: Bearer $CHANNEL_ACCESS_TOKEN" "$API/v2/bot/richmenu/alias/list")
echo "$ALIAS_LIST_JSON" | sed -e 's/{/\n{/g' | sed -n '1,20p' >/dev/null # quiet

CURRENT_ID=$(echo "$ALIAS_LIST_JSON" | jq -r --arg A "$ALIAS" '.aliases[] | select(.richMenuAliasId==$A).richMenuId' 2>/dev/null || true)
echo "  alias=$ALIAS current_id=${CURRENT_ID:-<none>}"

read -r -p "Proceed to create NEW richmenu for alias '$ALIAS'? [y/N] " yn
[[ "${yn:-N}" =~ ^[Yy]$ ]] || { echo "Canceled."; exit 1; }

echo "== Step 1: create richmenu (api.line.me) =="
CREATE_RES=$(curl -s -X POST "$API/v2/bot/richmenu" \
  -H "Authorization: Bearer $CHANNEL_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d @"$JSON_PATH")
echo "  create_res: $CREATE_RES"
NEW_ID=$(echo "$CREATE_RES" | jq -r '.richMenuId' 2>/dev/null || true)

if [[ -z "$NEW_ID" || "$NEW_ID" == "null" ]]; then
  echo "Failed to create richmenu (NEW_ID is null)."; exit 1
fi
echo "  NEW_ID=$NEW_ID"

echo "== Step 2: upload image (api-data.line.me) =="
curl -s -S -f -v -X POST "$APID/v2/bot/richmenu/$NEW_ID/content" \
  -H "Authorization: Bearer $CHANNEL_ACCESS_TOKEN" \
  -H "Content-Type: $CTYPE" \
  --data-binary @"$IMAGE_PATH" >/dev/null
echo "  image uploaded."

echo "== Step 3: attach alias to NEW_ID (api.line.me) =="
# 既存 alias があれば更新、無ければ作成
UPD_RES=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/v2/bot/richmenu/alias/$ALIAS" \
  -H "Authorization: Bearer $CHANNEL_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"richMenuId\":\"$NEW_ID\"}")
if [[ "$UPD_RES" != "200" ]]; then
  echo "  alias update returned $UPD_RES, try create..."
  curl -s -S -f -X POST "$API/v2/bot/richmenu/alias" \
    -H "Authorization: Bearer $CHANNEL_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"richMenuAliasId\":\"$ALIAS\",\"richMenuId\":\"$NEW_ID\"}" >/dev/null
fi
echo "  alias '$ALIAS' -> $NEW_ID"

echo "== Step 4: verify =="
curl -s -H "Authorization: Bearer $CHANNEL_ACCESS_TOKEN" "$API/v2/bot/richmenu/alias/list" | jq

echo "== Done. Tips =="
echo "- 端末に反映されない場合は、リッチメニューを一度 切替（開始↔終了）するとキャッシュ更新されます。"
if [[ -n "$CURRENT_ID" ]]; then
  echo "- 古いメニューを消す場合："
  echo "  curl -X DELETE \"$API/v2/bot/richmenu/$CURRENT_ID\" -H \"Authorization: Bearer \$CHANNEL_ACCESS_TOKEN\""
fi
