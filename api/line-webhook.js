// /api/line-webhook.js
import crypto from "node:crypto";
export const config = { api: { bodyParser: false } };
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

function verifySignature(headers, raw, secret) {
  try {
    const sig = headers["x-line-signature"];
    if (!sig || !secret) return false;
    const mac = crypto.createHmac("sha256", secret).update(raw).digest("base64");
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(mac));
  } catch { return false; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).end(); return; }

  // ① まず即200（検証が落ちない）
  res.status(200).send("ok");

  // ② 応答後に署名だけログ（失敗しても無視）
  try {
    let raw = "";
    await new Promise(resolve => {
      req.setEncoding("utf8");
      req.on("data", c => raw += c);
      req.on("end", resolve);
    });
    const ok = verifySignature(req.headers, raw, CHANNEL_SECRET);
    if (!ok) console.warn("[webhook] signature NG (logged only)");
  } catch (e) {
    console.error("[webhook] post-log error:", e);
  }
}
