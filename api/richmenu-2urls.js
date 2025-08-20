// /api/richmenu-2urls.js
// ※ Vercel Serverless Functions (Node runtime) 向け。
//    Edge用の Response.json は使いません。

const LINE_BASE = "https://api.line.me";
const TOKEN = process.env.CHANNEL_ACCESS_TOKEN || "";
const RICH_URL_LEFT  = process.env.RICH_URL_LEFT  || "";
const RICH_URL_RIGHT = process.env.RICH_URL_RIGHT || "";

// fetch にタイムアウトを付与（20秒）
async function fetchWithTimeout(url, opts = {}, ms = 20000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(id);
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
  // create
  let r = await fetchWithTimeout(`${LINE_BASE}/v2/bot/richmenu/alias`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ richMenuAliasId: aliasId, richMenuId }),
  });
  if (r.ok) return;

  // update
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
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const text = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`set default ${r.status} ${text}`);
}

// ★ ここが Node(Serverless) 形式のハンドラ
export default async function handler(req, res) {
  const debug = [];
  try {
    if (req.method !== "POST" && req.method !== "GET") {
      res.status(405).json({ ok: false, error: "method not allowed" });
      return;
    }

    if (!TOKEN) throw new Error("env: CHANNEL_ACCESS_TOKEN missing");
    if (!RICH_URL_LEFT || !RICH_URL_RIGHT) {
      throw new Error(`env: RICH_URL_LEFT/RIGHT missing (left=${!!RICH_URL_LEFT}, right=${!!RICH_URL_RIGHT})`);
    }

    const step = (req.query.step || "all").toString(); // health / create / upload / alias / apply / all

    // 自分の公開URLから画像URLを組み立て（/public/richmenu_v2.jpg）
    const origin = `https://${req.headers.host}`;
    const imgUrl = `${origin}/richmenu_v2.jpg`;
    const headRes = await fetchWithTimeout(imgUrl, { method: "GET", cache: "no-store" });
    debug.push({ imgUrl, imgStatus: headRes.status });
    if (!headRes.ok) throw new Error(`public image not found: ${imgUrl}`);

    if (step === "health") {
      res.status(200).json({ ok: true, step, debug, tip: "env & image OK" });
      return;
    }

    // 1) リッチメニュー作成（上段URL×2 / 下段 advisor_on へスイッチ）
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
    if (!richMenuId) throw new Error("no richMenuId from LINE API");
    debug.push({ step: "created", richMenuId });

    if (step === "create") { res.status(200).json({ ok: true, step, richMenuId, debug }); return; }

    // 2) 画像アップロード（JPG）
    await uploadImage(richMenuId, imgUrl, "image/jpeg");
    debug.push({ step: "image_uploaded" });

    if (step === "upload") { res.status(200).json({ ok: true, step, richMenuId, debug }); return; }

    // 3) alias: default に割り当て（作成 or 更新）
    await upsertAlias("default", richMenuId);
    debug.push({ step: "alias_default_set" });

    if (step === "alias") { res.status(200).json({ ok: true, step, richMenuId, debug }); return; }

    // 4) ?apply=1 か step=apply/all で全体反映
    const apply = req.query.apply === "1" || step === "apply" || step === "all";
    if (apply) {
      await setDefaultForAll(richMenuId);
      debug.push({ step: "applied_all" });
    }

    res.status(200).json({ ok: true, step, richMenuId, applied: apply, debug });
  } catch (e) {
    debug.push({ error: String(e?.message || e) });
    res.status(500).json({ ok: false, debug });
  }
}
