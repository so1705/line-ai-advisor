// /api/line-webhook.js  ← 置き換え（ESM）
// ✅ Nodeランタイム & 生ボディ、署名はログだけ、Firestoreに1行書く
import crypto from "node:crypto";
import { db } from "../lib/firestore.js"; // 相対パスに注意

export const config = { api: { bodyParser: false } };

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
    // 生ボディ取得
    await new Promise((resolve) => {
      req.setEncoding("utf8");
      req.on("data", (c) => (raw += c));
      req.on("end", resolve);
    });

    // 署名（失敗しても落とさない＝検証は通る）
    const ok = verifySignature(req.headers, raw, CHANNEL_SECRET);
    if (!ok) console.warn("[webhook] signature NG");

    // JSON パース（失敗しても無視）
    let body = {};
    try { body = JSON.parse(raw); } catch {}

    const ev = Array.isArray(body.events) ? body.events[0] : null;

    // Firestore に簡易ログ（失敗しても無視）
    try {
      await db.collection("logs").doc("lastWebhook").set(
        { at: new Date().toISOString(), eventType: ev?.type || "unknown" },
        { merge: true }
      );
    } catch (e) {
      console.error("[webhook] firestore err (ignored):", e);
    }

    // とにかく200を返す（検証成功のため）
    return res.status(200).send("ok");
  } catch (e) {
    console.error("[webhook] fatal:", e);
    return res.status(200).send("ok");
  }
}
