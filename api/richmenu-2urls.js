// /api/richmenu-2urls.js
export const runtime = "edge";

const LINE_BASE = "https://api.line.me";
const TOKEN = process.env.CHANNEL_ACCESS_TOKEN ?? "";
const RICH_URL_LEFT  = process.env.RICH_URL_LEFT  ?? "https://example.com/signup";
const RICH_URL_RIGHT = process.env.RICH_URL_RIGHT ?? "https://example.com/jobs";

/** JSON POST */
async function postJSON(path, json) {
  const res = await fetch(`${LINE_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(json),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${path} ${res.status} ${body}`);
  }
  return res.json().catch(() => ({}));
}

/** 画像アップロード（public 配下の実ファイルURLから Edge で転送） */
async function putImage(richMenuId, imgUrl, contentType = "image/jpeg") {
  const imgRes = await fetch(imgUrl);
  if (!imgRes.ok) throw new Error(`fetch image failed ${imgRes.status}`);
  const blob = await imgRes.arrayBuffer();
  const res = await fetch(`${LINE_BASE}/v2/bot/richmenu/${richMenuId}/content`, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      Authorization: `Bearer ${TOKEN}`,
    },
    body: blob,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`upload image ${res.status} ${body}`);
  }
}

/** alias を richMenuId に割当（create or update） */
async function setAlias(aliasId, richMenuId) {
  // まず作成を試す
  let res = await fetch(`${LINE_BASE}/v2/bot/richmenu/alias`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ richMenuAliasId: aliasId, richMenuId }),
  });
  if (res.ok) return true;

  // 既にあるなら更新
  res = await fetch(`${LINE_BASE}/v2/bot/richmenu/alias/${aliasId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ richMenuId }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`alias update ${res.status} ${body}`);
  }
  return true;
}

/** すべてのユーザーの既定メニューに設定 */
async function setDefault(richMenuId) {
  const res = await fetch(`${LINE_BASE}/v2/bot/user/all/richmenu/${richMenuId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`set default ${res.status} ${body}`);
  }
}

export default async function handler(request) {
  if (!TOKEN) return new Response("CHANNEL_ACCESS_TOKEN missing", { status: 500 });

  try {
    // 1) 新しい default 用メニュー（2URL + 下段 advisor_on へスイッチ）
    const size = { width: 2500, height: 1686 };
    const topH = 800;
    const midX = Math.floor(size.width / 2);

    const payload = {
      size,
      selected: true,
      name: "default_v2",
      chatBarText: "メニュー",
      areas: [
        // 上段 左：会員登録
        {
          bounds: { x: 0, y: 0, width: midX, height: topH },
          action: { type: "uri", label: "会員登録", uri: RICH_URL_LEFT },
        },
        // 上段 右：インターン求人一覧
        {
          bounds: { x: midX, y: 0, width: size.width - midX, height: topH },
          action: { type: "uri", label: "インターン求人一覧", uri: RICH_URL_RIGHT },
        },
        // 下段 全幅：advisor_on へ切替（※AI面談）
        {
          bounds: { x: 0, y: topH, width: size.width, height: size.height - topH },
          action: { type: "richmenuswitch", richMenuAliasId: "advisor_on", data: "toggle=on" },
        },
      ],
    };

    const created = await postJSON("/v2/bot/richmenu", payload);
    const richMenuId = created?.richMenuId;
    if (!richMenuId) throw new Error("no richMenuId");

    // 2) 画像アップロード（public のファイルURLを参照）
    const publicImgUrl = new URL("/richmenu_v2.jpg", request.url).toString();
    await putImage(richMenuId, publicImgUrl, "image/jpeg");

    // 3) alias: default を新メニューに差し替え
    await setAlias("default", richMenuId);

    // 4) ?apply=1 なら全体に反映
    const { searchParams } = new URL(request.url);
    const apply = searchParams.get("apply") === "1";
    if (apply) await setDefault(richMenuId);

    return Response.json({ ok: true, richMenuId, alias: "default", applied: apply });
  } catch (e) {
    console.error(e);
    return new Response(String(e?.message ?? "error"), { status: 500 });
  }
}
