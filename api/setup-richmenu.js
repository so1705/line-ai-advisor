// /api/setup-richmenu.js  (一時用ツール。デプロイして1回だけGETで叩く)
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

async function createRichMenu() {
  const payload = {
    size: { width: 2500, height: 1686 },
    selected: true,
    name: "AI面談トグル",
    chatBarText: "メニュー",
    areas: [{ bounds: { x: 0, y: 0, width: 2500, height: 1686 }, action: { type: "postback", data: "ai:toggle" } }],
  };
  const res = await fetch("https://api.line.me/v2/bot/richmenu", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()).richMenuId;
}

async function uploadImage(richMenuId) {
  // 画像は任意のPNG/JPEGを /public/richmenu.png に置く想定
  const imageUrl = `${process.env.VERCEL_URL ? "https://" + process.env.VERCEL_URL : ""}/richmenu.png`;
  // 簡易版：外部URLから取得してPUTしたいが、Vercel関数からは手間なので
  // まずは画像アップロードを手動（LINEコンソールやcurl）でやってもOK。
  // ここではスキップし、テキストのみ運用でも動作可能。
  return { uploaded: false, note: "画像アップロードは後でコンソール/curlで実施してください" };
}

async function linkToAllUsers(richMenuId) {
  const res = await fetch("https://api.line.me/v2/bot/user/all/richmenu/" + richMenuId, {
    method: "POST",
    headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` },
  });
  if (!res.ok) throw new Error(await res.text());
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).end();
    const id = await createRichMenu();
    const up = await uploadImage(id); // 任意
    await linkToAllUsers(id);
    return res.status(200).json({ ok: true, richMenuId: id, image: up });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
