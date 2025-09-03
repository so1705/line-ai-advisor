#!/usr/bin/env bash
set -euo pipefail

# ====== 設定（必要ならここだけ書き換え） ======
TOKEN='93z5cjoYZOdlJzHJcxt4mgFQV4qL21zfDZ5TlfG1h8FNutQz8Iu/iouWkB7gBLW0jjnW1gOI8ey2qYXC/NHXuGM36RMXDHup1tamml7DH2tMY2H+Aq4rieAi1xNphHcypbWtWXnqq5gWyI36Tqp7WAdB04t89/1O/w1cDnyilFU='
USER_ID='Udf7e663dd8dc222088172e431909859d'   # ← あなたのLINE userIdに変更

# 新メニューの “name” （あなたが作ったv3の名前に合わせる）
NAME_DEFAULT='default_v3'
NAME_ADVISOR='advisor_v3'

API='https://api.line.me/v2/bot'

echo "== 0) 現在の richmenu 一覧を取得 =="
LIST_JSON=$(curl -s -H "Authorization: Bearer $TOKEN" "$API/richmenu/list")
echo "$LIST_JSON" | jq '.richmenus | length as $n | "count=\($n)"'

echo "== 1) v3の richMenuId を抽出（name一致で特定） =="
DEF_ID=$(echo "$LIST_JSON" | jq -r --arg N "$NAME_DEFAULT" '.richmenus[]? | select(.name==$N) | .richMenuId' | head -n1)
ADV_ID=$(echo "$LIST_JSON" | jq -r --arg N "$NAME_ADVISOR" '.richmenus[]? | select(.name==$N) | .richMenuId' | head -n1)

if [[ -z "${DEF_ID:-}" || -z "${ADV_ID:-}" ]]; then
  echo "!! v3の richMenuId が見つかりません。名前が違うか、メニュー未作成です。"
  echo "   NAME_DEFAULT=$NAME_DEFAULT / NAME_ADVISOR=$NAME_ADVISOR を見直すか、作成処理を先に実行してください。"
  exit 1
fi

echo "   default_v3: $DEF_ID"
echo "   advisor_v3: $ADV_ID"

echo "== 2) 既存 alias を確認 =="
ALIAS_LIST=$(curl -s -H "Authorization: Bearer $TOKEN" "$API/richmenu/alias/list" | jq .)
echo "$ALIAS_LIST"

echo "== 3) alias を v3 のIDにアップサート（default / advisor_on） =="
# まず update（200が理想）→ダメなら create
upd() {
  local alias="$1" id="$2"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    "$API/richmenu/alias/$alias" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"richMenuId\":\"$id\"}")
  if [[ "$code" != "200" ]]; then
    echo "  update $alias -> $id ... $code (try create)"
    code=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
      "$API/richmenu/alias" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"richMenuAliasId\":\"$alias\",\"richMenuId\":\"$id\"}")
    [[ "$code" = "200" ]] || { echo "    create failed ($code)"; exit 1; }
  else
    echo "  update $alias -> OK"
  fi
}

upd "default"    "$DEF_ID"
upd "advisor_on" "$ADV_ID"

echo "== 4) alias が指すIDを最終確認 =="
curl -s -H "Authorization: Bearer $TOKEN" "$API/richmenu/alias/default" | jq .
curl -s -H "Authorization: Bearer $TOKEN" "$API/richmenu/alias/advisor_on" | jq .

echo "== 5) 端末を新IDに強制リリンク（default を貼る） =="
# いったん解除
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" "$API/user/$USER_ID/richmenu" >/dev/null || true
# default を貼る
curl -s -X POST -H "Authorization: Bearer $TOKEN" "$API/user/$USER_ID/richmenu/$DEF_ID" >/dev/null
echo "  linked: $USER_ID -> $DEF_ID"

echo "== 6) 端末の現在リンクを確認 =="
curl -s -H "Authorization: Bearer $TOKEN" "$API/user/$USER_ID/richmenu" | jq .

echo "== 7) （任意）不要な古いリッチメニューを削除ガイド =="
# aliasが指しているID以外を列挙
KEEP_IDS=$(printf "%s\n%s\n" "$DEF_ID" "$ADV_ID")
echo "$LIST_JSON" | jq -r '.richmenus[]?.richMenuId' | while read -r id; do
  if grep -qx "$id" <(echo "$KEEP_IDS"); then
    echo "  keep $id"
  else
    echo "  delete candidate: $id"
    # 実際に削除する場合は↓のコメントアウトを外す
    # curl -s -X DELETE -H "Authorization: Bearer $TOKEN" "$API/richmenu/$id" >/dev/null && echo "  deleted $id"
  fi
done

echo "== 完了 =="
echo "・LINEアプリを再起動→上段タップで advisor_on ↔ default を1往復すると反映が早いです。"
