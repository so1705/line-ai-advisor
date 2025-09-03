#!/usr/bin/env bash
set -euo pipefail

: "${CHANNEL_ACCESS_TOKEN:?Set CHANNEL_ACCESS_TOKEN first}"

API="https://api.line.me"
APID="https://api-data.line.me"

ALIAS=""
JSON_PATH=""
IMAGE_PATH=""
CTYPE="image/png"   # ← デフォルトをPNGにしておく
LINK_USER=""
APPLY_ALL="0"
CONFIRM="1"

usage() {
  cat <<USAGE
Usage:
  $0 --alias <default|advisor_on> --json <richmenu.json> --image <path> [--type image/png] [--link-user <USER_ID>] [--apply-all] [--yes]
USAGE
  exit 1
}

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

command -v jq >/dev/null || { echo "jq is required."; exit 1; }

echo "== Step 1: create richmenu =="
CREATE_RES=$(curl -sS -X POST "$API/v2/bot/richmenu" \
  -H "Authorization: Bearer $CHANNEL_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  --data @"$JSON_PATH")
NEW_ID=$(echo "$CREATE_RES" | jq -r '.richMenuId // empty')
[[ -z "$NEW_ID" ]] && { echo "Failed to create richmenu."; exit 1; }
echo "  NEW_ID=$NEW_ID"

echo "== Step 2: upload image =="
curl -sS -f -X POST "$APID/v2/bot/richmenu/$NEW_ID/content" \
  -H "Authorization: Bearer $CHANNEL_ACCESS_TOKEN" \
  -H "Content-Type: $CTYPE" \
  --data-binary @"$IMAGE_PATH" >/dev/null
echo "  image uploaded."

echo "== Step 3: upsert alias =="
curl -sS -X POST "$API/v2/bot/richmenu/alias" \
  -H "Authorization: Bearer $CHANNEL_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"richMenuAliasId\":\"$ALIAS\",\"richMenuId\":\"$NEW_ID\"}" >/dev/null
echo "  alias '$ALIAS' -> $NEW_ID"

echo "Done."
