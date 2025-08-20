// /pages/api/richmenu-2urls.js
export const runtime = "edge";

const LINE_BASE = "https://api.line.me";
const TOKEN = process.env.CHANNEL_ACCESS_TOKEN || "";
const RICH_URL_LEFT  = process.env.RICH_URL_LEFT  || "";
const RICH_URL_RIGHT = process.env.RICH_URL_RIGHT || "";

// fetch にタイムアウトを付ける小道具（20s）
async function fetchWithTimeout(url, opts = {}, ms = 20000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: c.signal });
  } finally {
    clearTimeout(t);
  }
}

async function postJSON(path, json) {
  const res = await fetchWithTimeout(`${LINE_BASE}${path}`, {
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
  const imgRes = await fetchWithTimeout(imgUrl, { cache: "no-store" });
  if (!imgRes.ok) throw new Error(`image fetch ${imgRes.status} ${imgUrl}`);
  const body = await imgRes.arrayBuffer();
  const res = await fetchWithTimeout(`${LINE_BASE}/v2/bot/richmenu/${richMenuId}/content`, {
    method: "POST",
    headers: { "Content-Type": contentType, Authorization: `Bearer ${TOKEN}` },
    body,
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`image upload ${res.status} ${text}`);
}

async function upsertAlias(aliasId, richMenuId) {
  // 作成
  let r = await fetchWithTimeout(`${LINE_BASE}/v2/bot/richmenu/alias`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ richMenuAliasId: aliasId, richMenuId }),
  });
  if (r.ok) return;
  // 更新
  r = await fetchWithTimeout(`${LINE_BASE}/v2/bot/richmenu/alias/${aliasId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ richMenuId }),
  });
  const text = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`alias upsert ${aliasId} ${r.status} ${text}`);
}

async function setDefault(richMenuId) {
  const r = await fetchWithTimeout(`${LINE_BASE}/v2/bot/user/all/richmenu/${richMenuId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const text = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`set default ${r.status} ${text}`);
}

export default async function handler(request) {
  const debug = [];
  try {
    // 入力と環境チェック
    if (!TOKEN) throw new Error("env: CHANNEL_ACCESS_TOKEN missing");
    if (!RICH_URL_LEFT || !RICH_URL_RIGHT) {
      throw new Error(`env: RICH_URL_LEFT/RIGHT missing (left=${!!RICH_URL_LEFT}, right=${!!RICH_URL_RIGHT})`);
    }

    const url = new URL(request.url);
    const step = url.searchParams.get("step") || "all"; // health / create / upload / alias / apply / all

    const imgUrl = new URL("/richmenu_v2.jpg", request.url).toString();
    const imgHead = await fetchWithTimeout(imgUrl, { method: "GET", cache: "no-store" });
    debug.push({ imgUrl, imgStatus: imgHead.status });
    if (!imgHead.ok) throw new Error(`public image not found: ${imgUrl}`);

    if (step === "health") {
      return Response.json({ ok: true, step, debug, tip: "env & image OK" });
    }

    // 作成（上段URL×2 / 下段 advisor_on）
    const size = { width: 2500, height: 1686 };
    const topH = 800, midX = Math.floor(size.width / 2);
    const payload = {
      size, selected: true, name: "default_v2", chatBarText: "メニュー",
      areas: [
        { bounds: { x: 0, y: 0, width: midX, height: topH }, action: { type: "uri", label: "会員登録", uri: RICH_URL_LEFT } },
        { bounds: { x: midX, y: 0, width: size.width - midX, height: topH }, action: { type: "uri", label: "インターン求人一覧", uri: RICH_URL_RIGHT } },
        { bounds: { x: 0, y: topH, width: size.width, height: size.height - topH }, action: { type: "richmenuswitch", richMenuAliasId: "advisor_on", data: "toggle=on" } },
      ],
    };

    const created = await postJSON("/v2/bot/richmenu", payload);
    const richMenuId = created?.richMenuId;
    if (!richMenuId) throw new Error("no richMenuId");
    debug.push({ step: "created", richMenuId });

    if (step === "create") return Response.json({ ok: true, step, richMenuId, debug });

    // 画像アップロード
    await uploadImage(richMenuId, imgUrl, "image/jpeg");
    debug.push({ step: "image_uploaded" });

    if (step === "upload") return Response.json({ ok: true, step, richMenuId, debug });

    // alias: default に割当
    await upsertAlias("default", richMenuId);
    debug.push({ step: "alias_default_set" });

    if (step === "alias") return Response.json({ ok: true, step, richMenuId, debug });

    // ?apply=1 または step=apply で全体適用
    const applyFlag = url.searchParams.get("apply") === "1" || step === "apply" || step === "all";
    if (applyFlag) {
      await setDefault(richMenuId);
      debug.push({ step: "applied_all" });
    }

    return Response.json({ ok: true, step, richMenuId, debug });
  } catch (e) {
    debug.push({ error: String(e?.message || e) });
    return Response.json({ ok: false, debug }, { status: 500 });
  }
}
