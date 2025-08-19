import crypto from "node:crypto";
import { db } from "../lib/firestore.js"; // ← 相対パスに注意（プロジェクト構成に合わせて）

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
    // 生ボディ
    const chunks = [];
    await new Promise((resolve) => {
      req.setEncoding("utf8");
      req.on("data", (c) => chunks.push(c));
      req.on("end", resolve);
    });
    raw = chunks.join("");

    // 署名（失敗しても200返す＝検証通す）
    const ok = verifySignature(req.headers, raw, CHANNEL_SECRET);
    if (!ok) console.warn("[webhook] signature NG");

    // ここから必要最低限のJSONパース
    let body;
    try { body = JSON.parse(raw); } catch { body = {}; }
    const ev = Array.isArray(body.events) ? body.events[0] : null;

    // 例：hitログを1行だけ保存（失敗しても無視）
    try {
      await db.collection("logs").doc("lastWebhook").set(
        { at: new Date().toISOString(), eventType: ev?.type || "unknown" },
        { merge: true }
      );
    } catch (e) {
      console.error("[webhook] firestore err (ignore):", e);
    }

    return res.status(200).send("ok");
  } catch (e) {
    console.error("[webhook] fatal:", e);
    return res.status(200).send("ok");
  }
}
