// /api/line-webhook.js
import crypto from "node:crypto";
import { db } from "../lib/firestore.js";
import { replyMessage, MSG } from "../lib/line.js";

export const config = { api: { bodyParser: false } };
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

// 生ボディを先に読み切る（署名は Buffer で計算）
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
function verifySignature(headers, rawBuf, secret) {
  try {
    const sig = headers["x-line-signature"];
    if (!sig || !secret) return false;
    const mac = crypto.createHmac("sha256", secret).update(rawBuf).digest("base64");
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(mac));
  } catch { return false; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  // 1) まず読み切る
  const raw = await readRawBody(req);
  const at = new Date().toISOString();

  // 2) 署名
  const sigOK = verifySignature(req.headers, raw, CHANNEL_SECRET);

  // 3) JSONへ
  let body = {}; try { body = JSON.parse(raw.toString("utf-8")); } catch {}
  const events = Array.isArray(body.events) ? body.events : [];

  // 4) 受信ログ（sample保存でデバッグ容易に）
  try {
    await db.collection("logs").doc("lastWebhook")
      .set({ at, sigOK, sample: events[0] ?? null }, { merge: true });
  } catch {}

  // 5) 署名NGなら固定返信（返信できる時のみ）
  if (!sigOK) {
    const rt = events[0]?.replyToken;
    if (rt) { try { await replyMessage(rt, MSG.SIGNATURE_NG); } catch {} }
    res.status(200).send("ok");
    return;
  }

  // 6) ここで ACK を“同期的”に返す（確実に見える）
  for (const ev of events) {
    if (ev.type === "message" && ev.message?.type === "text" && ev.replyToken) {
      try { await replyMessage(ev.replyToken, MSG.ACK); } catch {}
    }
  }

  // 7) 即200（Webhookはここで終了）
  res.status(200).send("ok");

  // 8) AI生成＋push は別APIに fire-and-forget で委譲
  for (const ev of events) {
    if (ev.type === "message" && ev.message?.type === "text") {
      const userId = ev?.source?.userId;
      const text = (ev.message.text || "").trim();
      if (!userId || !text) continue;

      // 失敗しても無視（ログは _ai-push 側で残す）
      fetch(`${getOrigin(req)}/api/_ai-push`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Worker-Key": process.env.WORKER_KEY || "",
        },
        body: JSON.stringify({ userId, text }),
      }).catch(() => {});
    }
  }
}

function getOrigin(req) {
  // Vercel 環境なら host ヘッダが入る
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = (req.headers["x-forwarded-proto"] || "https");
  return `${proto}://${host}`;
}
