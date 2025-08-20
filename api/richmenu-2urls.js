// /pages/api/richmenu-2urls.js
export const runtime = "edge";

const LINE_BASE = "https://api.line.me";
const TOKEN = process.env.CHANNEL_ACCESS_TOKEN || "";
const RICH_URL_LEFT  = process.env.RICH_URL_LEFT  || "";
const RICH_URL_RIGHT = process.env.RICH_URL_RIGHT || "";

/** helper */
async function fetchJSON(path, json) {
  const res = await fetch(`${LINE_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(json),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`${path} ${res.status} ${text}`);
  try { return JSON.parse(text); } catch { return {}; }
}

async function uploadImage(richMenuId, imgUrl, contentType = "image/jpeg") {
  const imgRes = await fetch(imgUrl, { cache: "no-store" });
  if (!imgRes.ok) throw new Error(`image fetch ${imgRes.status} ${imgUrl}`);
  const blob = await imgRes.arrayBuffer();
  const res = await fetch(`${LINE_BASE}/v2/bot/richmenu/${richMenuId}/content`, {
    method: "POST",
    headers: { "Content-Type": contentType, Authorization: `Bearer ${TOKEN}` },
    body: blob,
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`image upload ${res.status} ${text}`);
}

async function upsertAlias(aliasId, richMenuId) {
  // create
  let r = await fetch(`${LINE_BASE}/v2/bot/richmenu/alias`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ richMenuAliasId: aliasId, richMenuId }),
  });
  if (r.ok) return;
  // update
  r = await fetch(`${LINE_BASE}/v2/bot/richmenu/alias/${aliasId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ richMenuId }),
  });
  const text = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`alias upsert ${aliasId} ${r.status} ${text}`);
}

async function setDefault(richMenuId) {
  const r = await fetch(`${LINE_BASE}/v2/bot/user/all/richmenu/${richMenuId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const text = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`set default ${r.status} ${text}`);
}

export default async function handler(request) {
  const debug = [];
  try {
    // 0) 事前チェック
    if (!TOKEN) throw new Error("env: CHANNEL_ACCESS_TOKEN is empty");
    if (!RICH_URL_LEFT || !RICH_URL_RIGHT) {
      throw new Error(`env: RICH_URL_LEFT/RIGHT missing (left=${!!RICH_URL_LEFT}, right=${!!RICH_URL_RIGHT})`);
    }

    const imgUrl = new URL("/richmenu_v2.jpg", request.url).toString();
    const headRes = await fetch(imgUrl, { method: "GET", cache: "no-store" });
    debug.push({ imgUrl, imgStatus: headRes.status });
    if (!headRes.ok) throw new Error(`public image not found: ${imgUrl}`);

    // 1) リッチメニュー作成（上段URL×2／下段 advisor_on）
    const size = { width: 2500, height: 1686 };
    const topH = 800;
    const midX = Math.floor(size.width / 2);

    const payload = {
      size,
      selected: true,
      name: "default_v2",
      chatBarText: "メニュー",
      areas: [
        { bounds: { x: 0, y: 0, width: midX, height: topH }, action: { type: "uri", label: "会員登録", uri: RICH_URL_LEFT } },
        { bounds: { x: midX, y: 0, width: size.width - midX, height: topH }, action: { type: "uri", label: "インターン求人一覧", uri: RICH_URL_RIGHT } },
        { bounds: { x: 0, y: topH, width: size.width, height: size.height - topH }, action: { type: "richmenuswitch", richMenuAliasId: "advisor_on", data: "toggle=on" } },
      ],
    };

    const created = await fetchJSON("/v2/bot/richmenu", payload);
    const richMenuId = created?.richMenuId;
    if (!richMenuId) throw new Error("no richMenuId from LINE API");
    debug.push({ step: "created", richMenuId });

    // 2) 画像アップロード（jpg）
    await uploadImage(richMenuId, imgUrl, "image/jpeg");
    debug.push({ step: "image_uploaded" });

    // 3) alias: default に差し替え
    await upsertAlias("default", richMenuId);
    debug.push({ step: "alias_default_set" });

    // 4) ?apply=1 なら全体適用
    const apply = new URL(request.url).searchParams.get("apply") === "1";
    if (apply) { await setDefault(richMenuId); debug.push({ step: "applied_all" }); }

    return Response.json({ ok: true, richMenuId, applied: apply, debug });
  } catch (e) {
    debug.push({ error: String(e?.message || e) });
    // エラー内容をそのまま返す（原因特定用）
    return Response.json({ ok: false, debug }, { status: 500 });
  }
}
