// /api/line-webhook.js
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

  try {
    // 1) 生ボディをサッと取得（数百バイト～数KB）
    let raw = "";
    await new Promise(resolve => {
      req.setEncoding("utf8");
      req.on("data", c => (raw += c));
      req.on("end", resolve);
    });

    // 2) 署名はチェック（失敗しても処理は継続）
    const sigOK = verifySignature(req.headers, raw, CHANNEL_SECRET);
    if (!sigOK) console.warn("[webhook] signature NG");

    // 3) JSON化して最小情報を抽出（検証は events なし＝none になるのが正常）
    let body = {};
    try { body = JSON.parse(raw); } catch {}
    const first = Array.isArray(body.events) ? body.events[0] : null;
    const eventType = first?.type ?? "none";

    // 4) Firestoreへ “軽量ログ” を先に書く（失敗しても握りつぶす）
    try {
      await db.collection("logs").doc("lastWebhook").set(
        { at: new Date().toISOString(), lastEvent: eventType },
        { merge: true }
      );
    } catch (e) {
      console.error("[webhook] firestore log err:", e);
    }

    // 5) 最後に200を返す（ここまで数十msで終わります）
    res.status(200).send("ok");
  } catch (e) {
    console.error("[webhook] fatal:", e);
    // 検証を落とさない
    res.status(200).send("ok");
  }
}
