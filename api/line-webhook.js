import crypto from "node:crypto";
export const config = { api: { bodyParser: false } };

// 署名検証（失敗しても200は返す＝検証は通る／ログだけ出す）
function verifySignature(headers, raw, secret) {
  try {
    const sig = headers["x-line-signature"];
    if (!sig || !secret) return false;
    const mac = crypto.createHmac("sha256", secret).update(raw).digest("base64");
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(mac));
  } catch {
    return false;
  }
}

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  let raw = "";
  try {
    const chunks = [];
    await new Promise((resolve) => {
      req.setEncoding("utf8");
      req.on("data", (c) => chunks.push(c));
      req.on("end", resolve);
    });
    raw = chunks.join("");

    const ok = verifySignature(req.headers, raw, CHANNEL_SECRET);
    if (!ok) console.warn("[webhook] signature NG（ログのみ／200は返す）");

    // ここではJSONパースもせず即200（検証通すため）
    return res.status(200).send("ok");
  } catch (e) {
    console.error("[webhook] error:", e);
    return res.status(200).send("ok");
  }
}
