// /api/line-webhook.js
import crypto from "node:crypto";
import { db } from "../lib/firestore.js";  // 相対パス注意
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

  // ① 即200（検証を確実に通す）
  res.status(200).send("ok");

  // ② 応答後の処理（失敗してもOK）
  try {
    let raw = "";
    await new Promise(resolve => {
      req.setEncoding("utf8");
      req.on("data", c => raw += c);
      req.on("end", resolve);
    });

    const ok = verifySignature(req.headers, raw, CHANNEL_SECRET);
    if (!ok) console.warn("[webhook] signature NG");

    let body = {};
    try { body = JSON.parse(raw); } catch {}
    const ev = Array.isArray(body.events) ? body.events[0] : null;

    // Firestoreへ軽量ログ
    try {
      await db.collection("logs").doc("lastWebhook").set(
        { at: new Date().toISOString(), eventType: ev?.type || "unknown" },
        { merge: true }
      );
    } catch (e) {
      console.error("[webhook] firestore log err:", e);
    }
  } catch (e) {
    console.error("[webhook] post process fatal:", e);
  }
}
