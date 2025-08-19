// /api/line-webhook.js （ESM・Nodeランタイム）
import crypto from "node:crypto";
import { db } from "../lib/firestore.js";

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

  // ★ まず即200を返す（検証のタイムアウト防止）
  res.status(200).send("ok");

  // ↓ここからは “応答後” に非同期で処理（awaitしない）
  try {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", c => (raw += c));
    req.on("end", async () => {
      try {
        const sigOK = verifySignature(req.headers, raw, CHANNEL_SECRET);
        if (!sigOK) console.warn("[webhook] signature NG");

        let body = {};
        try { body = JSON.parse(raw); } catch {}
        const first = Array.isArray(body.events) ? body.events[0] : null;
        const eventType = first?.type ?? "none";

        // 軽量ログ（失敗しても無視）
        try {
          await db.collection("logs").doc("lastWebhook").set(
            { at: new Date().toISOString(), lastEvent: eventType },
            { merge: true }
          );
        } catch (e) {
          console.error("[webhook] firestore log err:", e);
        }
      } catch (e) {
        console.error("[webhook] post process fatal:", e);
      }
    });
  } catch (e) {
    console.error("[webhook] outer fatal:", e);
  }
}
