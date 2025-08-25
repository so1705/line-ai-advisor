#!/usr/bin/env bash
set -euo pipefail

# 必須: 環境変数
: "${CHANNEL_ACCESS_TOKEN:?Set CHANNEL_ACCESS_TOKEN first}"

API="https://api.line.me"
APID="https://api-data.line.me"

# 引数
ALIAS=""
JSON_PATH=""
IMAGE_PATH=""
CTYPE="image/jpeg"
LINK_USER=""         # 例: Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
APPLY_ALL="0"        # 1 にすると全ユーザー既定に適用
CONFIRM="1"          # 0 にするとプロンプト無し実行

usage() {
  cat <<USAGE
Usage:
  $0 --alias <default|advisor_on> --json <richmenu.json> --image <path> [--type image/jpeg|image/png] [--link-user <USER_ID>] [--apply-all] [--yes]

Options:
  --alias       エイリアスID（default / advisor_on など）
  --json        リッチメニュー定義JSON
  --image       画像ファイル（2500x1686 / JPG or PNG）
  --type        Content-Type (image/jpeg または image/png)
  --link-user   作成後、そのユーザーにだけ即適用（テストに便利）
  --apply-all   作成後、全ユーザーの既定に設定
  --yes         確認プロンプトを出さずに実行
USAGE
  exit 1
}

# 引数パース
while [[ $# -gt 0 ]]; do
  case "$1" in
    --alias) ALIAS="$2"; shift 2 ;;
    --json) JSON_PATH="$2"; shift 2 ;;
    --image) IMAGE_PATH="$2"; shift 2 ;;
    --type) CTYPE="$2"; shift 2 ;;
    --link-user) LINK_USER="$2"; shift 2 ;;
    --apply-all) APPLY_ALL="1"; shift 1 ;;
    --yes|-y) CONFIRM="0"; shift 1 ;;
    *) echo "Unknown arg: $1"; usage ;;
  esac
done

[[ -z "$ALIAS" || -z "$JSON_PATH" || -z "$IMAGE_PATH" ]] && usage
[[ ! -f "$JSON_PATH" ]] && { echo "JSON not found: $JSON_PATH"; exit 1; }
[[ ! -f "$IMAGE_PATH" ]] && { echo "Image not found: $IMAGE_PATH"; exit 1; }

# 依存: jq チェック
command -v jq >/dev/null || { echo "jq is required."; exit 1; }

echo "== Input =="
echo "  alias      : $ALIAS"
echo "  json       : $JSON_PATH"
echo "  image      : $IMAGE_PATH"
echo "  type       : $CTYPE"
echo "  link-user  : ${LINK_USER:-<none>}"
echo "  apply-all  : ${APPLY_ALL}"

# 画像形式ざっくり検査
if command -v file >/dev/null; then
  SIG=$(file -b "$IMAGE_PATH" || true)
  echo "  file(...)  : $SIG"
fi

echo "== Step 0: alias 現状確認 =="
ALIAS_LIST_JSON=$(curl -s -H "Authorization: Bearer $CHANNEL_ACCESS_TOKEN" "$API/v2/bot/richmenu/alias/list" || echo '{}')
CURRENT_ID=$(echo "$ALIAS_LIST_JSON" | jq -r --arg A "$ALIAS" '.aliases[]? | select(.richMenuAliasId==$A).richMenuId' 2>/dev/null || true)
echo "  alias=$ALIAS current_id=${CURRENT_ID:-<none>}"

if [[ "$CONFIRM" = "1" ]]; then
  read -r -p "Proceed to create NEW richmenu for alias '$ALIAS'? [y/N] " yn
  [[ "${yn:-N}" =~ ^[Yy]$ ]] || { echo "Canceled."; exit 1; }
fi

echo "== Step 1: create richmenu (api.line.me) =="
CREATE_RES=$(curl -sS -X POST "$API/v2/bot/richmenu" \
  -H "Authorization: Bearer $CHANNEL_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  --data @"$JSON_PATH")
echo "  create_res: $CREATE_RES"
NEW_ID=$(echo "$CREATE_RES" | jq -r '.richMenuId // empty')
[[ -z "$NEW_ID" ]] && { echo "Failed to create richmenu (no id)."; exit 1; }
echo "  NEW_ID=$NEW_ID"

echo "== Step 2: upload image (api-data.line.me) =="
# 注意: 画像アップロードは api-data.host
curl -sS -f -X POST "$APID/v2/bot/richmenu/$NEW_ID/content" \
  -H "Authorization: Bearer $CHANNEL_ACCESS_TOKEN" \
  -H "Content-Type: $CTYPE" \
  --data-binary @"$IMAGE_PATH" >/dev/null
echo "  image uploaded."

echo "== Step 3: upsert alias -> NEW_ID (api.line.me) =="
# まず update を試す (200想定)。405/404 等なら create。
UPD_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/v2/bot/richmenu/alias/$ALIAS" \
  -H "Authorization: Bearer $CHANNEL_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"richMenuId\":\"$NEW_ID\"}")
if [[ "$UPD_CODE" != "200" ]]; then
  echo "  alias update returned $UPD_CODE, try create..."
  CRT_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/v2/bot/richmenu/alias" \
    -H "Authorization: Bearer $CHANNEL_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"richMenuAliasId\":\"$ALIAS\",\"richMenuId\":\"$NEW_ID\"}")
  [[ "$CRT_CODE" = "200" ]] || { echo "  alias create failed ($CRT_CODE)"; exit 1; }
fi
echo "  alias '$ALIAS' -> $NEW_ID"

# 任意: 自分へ即時適用
if [[ -n "$LINK_USER" ]]; then
  echo "== Step 4a: link to user (for test) =="
  curl -sS -X DELETE -H "Authorization: Bearer $CHANNEL_ACCESS_TOKEN" \
    "$API/v2/bot/user/$LINK_USER/richmenu" >/dev/null || true
  curl -sS -f -X POST -H "Authorization: Bearer $CHANNEL_ACCESS_TOKEN" \
    "$API/v2/bot/user/$LINK_USER/richmenu/$NEW_ID" >/dev/null
  echo "  linked to user: $LINK_USER"
fi

# 任意: 全ユーザー既定に
if [[ "$APPLY_ALL" = "1" ]]; then
  echo "== Step 4b: set as default for ALL users =="
  curl -sS -f -X POST -H "Authorization: Bearer $CHANNEL_ACCESS_TOKEN" \
    "$API/v2/bot/user/all/richmenu/$NEW_ID" >/dev/null
  echo "  set as default for all."
fi

echo "== Verify =="
curl -s -H "Authorization: Bearer $CHANNEL_ACCESS_TOKEN" "$API/v2/bot/richmenu/alias/list" | jq

echo "== Tips =="
echo "- 端末に反映されない場合は、リッチメニューを一度 切替（開始↔終了）すると早く更新されます。"
if [[ -n "${CURRENT_ID:-}" ]]; then
  echo "- 旧メニューを消す場合:"
  echo "  curl -X DELETE \"$API/v2/bot/richmenu/$CURRENT_ID\" -H \"Authorization: Bearer \$CHANNEL_ACCESS_TOKEN\""
fi

echo "Done."
