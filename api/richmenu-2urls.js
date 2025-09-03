// /api/richmenu-2urls.js
// Vercel Serverless Functions (Node runtime)

const LINE_BASE = "https://api.line.me";
const TOKEN = process.env.CHANNEL_ACCESS_TOKEN || "";

// 下3リンク用URL（左・中・右）
const RICH_URL_LEFT  = process.env.RICH_URL_LEFT  || "";
const RICH_URL_MID   = process.env.RICH_URL_MID   || ""; // 新規
const RICH_URL_RIGHT = process.env.RICH_URL_RIGHT || "";

async function fetchWithTimeout(url, opts = {}, ms = 20000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try { return await fetch(url, { ...opts, signal: controller.signal }); }
  finally { clearTimeout(id); }
}

async function postJSON(path, json) {
  const res = await fetchWithTimeout(`${LINE_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(json),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`${path} ${res.status} ${text}`);
  try { return JSON.parse(text); } catch { return {}; }
}

async function uploadImage(richMenuId, imgUrl, contentType = "image/png") {
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
  let r = await fetchWithTimeout(`${LINE_BASE}/v2/bot/richmenu/alias`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ richMenuAliasId: aliasId, richMenuId }),
  });
  if (r.ok) return;

  r = await fetchWithTimeout(`${LINE_BASE}/v2/bot/richmenu/alias/${aliasId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ richMenuId }),
  });
  const text = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`alias upsert ${aliasId} ${r.status} ${text}`);
}

async function setDefaultForAll(richMenuId) {
  const r = await fetchWithTimeout(`${LINE_BASE}/v2/bot/user/all/richmenu/${richMenuId}`, {
    method: "POST", headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const text = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`set default ${r.status} ${text}`);
}

// JSON組み立て（上：スイッチ / 下：3分割URL）
function buildPayload(kind = "default") {
  const size = { width: 2500, height: 1686 };
  const topH = 700;
  const colW = Math.floor(size.width / 3); // 833
  const midW = size.width - (colW * 2);    // 834

  const commonBottom = [
    { bounds: { x: 0, y: topH, width: colW, height: size.height - topH },
      action: { type: "uri", label: "会員登録", uri: RICH_URL_LEFT } },
    { bounds: { x: colW, y: topH, width: midW, height: size.height - topH },
      action: { type: "uri", label: "求人情報", uri: RICH_URL_MID || RICH_URL_RIGHT } },
    { bounds: { x: colW + midW, y: topH, width: colW, height: size.height - topH },
      action: { type: "uri", label: "最新情報", uri: RICH_URL_RIGHT } },
  ];

  if (kind === "default") {
    return {
      size, selected: true, name: "default_v3", chatBarText: "メニュー",
      areas: [
        { bounds: { x: 0, y: 0, width: size.width, height: topH },
          action: { type: "richmenuswitch", richMenuAliasId: "advisor_on", data: "mode=advisor_on" } },
        ...commonBottom,
      ],
    };
  }
  return {
    size, selected: false, name: "advisor_v3", chatBarText: "AIアドバイザー中",
    areas: [
      { bounds: { x: 0, y: 0, width: size.width, height: topH },
        action: { type: "richmenuswitch", richMenuAliasId: "default", data: "mode=default" } },
      ...commonBottom,
    ],
  };
}

// handler
export default async function handler(req, res) {
  const debug = [];
  try {
    if (req.method !== "POST" && req.method !== "GET") {
      res.status(405).json({ ok: false, error: "method not allowed" });
      return;
    }
    if (!TOKEN) throw new Error("env: CHANNEL_ACCESS_TOKEN missing");
    if (!RICH_URL_LEFT || !RICH_URL_RIGHT) {
      throw new Error(`env: URL missing (left=${!!RICH_URL_LEFT}, mid=${!!RICH_URL_MID}, right=${!!RICH_URL_RIGHT})`);
    }

    const step = (req.query.step || "all").toString();   // health/create/upload/alias/apply/all
    const menu = (req.query.menu || "both").toString();  // default/advisor/both

    // 画像URL（/public/default.png / /public/advisor.png）
    const origin = `https://${req.headers.host}`;
    const imgDefault = `${origin}/default.png`;
    const imgAdvisor = `${origin}/advisor.png`;

    // 画像存在チェック
    const stDef = (await fetchWithTimeout(imgDefault, { method: "GET", cache: "no-store" })).status;
    const stAdv = (await fetchWithTimeout(imgAdvisor, { method: "GET", cache: "no-store" })).status;
    debug.push({ imgDefault, stDef, imgAdvisor, stAdv });
    if (!(stDef >= 200 && stDef < 400)) throw new Error(`public image not found: ${imgDefault}`);
    if (!(stAdv >= 200 && stAdv < 400)) throw new Error(`public image not found: ${imgAdvisor}`);

    if (step === "health") {
      res.status(200).json({ ok: true, step, menu, debug, tip: "env & image OK" });
      return;
    }

    const results = {};

    // default
    if (menu === "default" || menu === "both") {
      const createdD = await postJSON("/v2/bot/richmenu", buildPayload("default"));
      const defId = createdD?.richMenuId; if (!defId) throw new Error("no richMenuId (default)");
      if (step === "create") { res.status(200).json({ ok: true, step, defId, debug }); return; }
      await uploadImage(defId, imgDefault, "image/png");
      if (step === "upload") { res.status(200).json({ ok: true, step, defId, debug }); return; }
      await upsertAlias("default", defId);
      results.defId = defId;
    }

    // advisor_on
    if (menu === "advisor" || menu === "both") {
      const createdA = await postJSON("/v2/bot/richmenu", buildPayload("advisor"));
      const advId = createdA?.richMenuId; if (!advId) throw new Error("no richMenuId (advisor)");
      if (step === "create") { res.status(200).json({ ok: true, step, advId, debug }); return; }
      await uploadImage(advId, imgAdvisor, "image/png");
      if (step === "upload") { res.status(200).json({ ok: true, step, advId, debug }); return; }
      await upsertAlias("advisor_on", advId);
      results.advId = advId;
    }

    // 既定適用（任意）
    const apply = req.query.apply === "1" || step === "apply" || step === "all";
    if (apply && results.defId) await setDefaultForAll(results.defId);

    res.status(200).json({ ok: true, step, menu, applied: apply, ...results, debug });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
