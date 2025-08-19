// /api/line-webhook.js
import crypto from "node:crypto";
import { db } from "../lib/firestore.js";

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const BASE = "https://api.line.me/v2/bot";
const HEAD = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
});

export const config = { api: { bodyParser: false } };

function readRaw(req) {
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
async function replyMessage(replyToken, messages) {
  const res = await fetch(`${BASE}/message/reply`, {
    method: "POST",
    headers: HEAD(),
    body: JSON.stringify({ replyToken, messages: [].concat(messages) }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`reply ${res.status}: ${t}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow","POST"); return res.status(405).send("Method Not Allowed"); }

  const raw = await readRaw(req);
  const at = new Date().toISOString();
  const sigOK = verifySignature(req.headers, raw, CHANNEL_SECRET);

  let body = {}; try { body = JSON.parse(raw.toString("utf-8")); } catch {}
  const events = Array.isArray(body.events) ? body.events : [];

  // 直近ログ（何が届いたか丸ごと確認）
  try {
    await db.collection("logs").doc("lastWebhook").set(
      { at, sigOK, count: events.length, sample: events[0] ?? null },
      { merge: true }
    );
  } catch {}

  // 署名NG→即200（検証を止めない）
  if (!sigOK) { return res.status(200).send("ok"); }

  // ★ 実メッセージがあるときだけ、先にエコー返信してから200を返す
  let replied = false;
  for (const ev of events) {
    if (ev.type === "message" && ev.message?.type === "text" && ev.replyToken) {
      try {
        await replyMessage(ev.replyToken, [{ type: "text", text: `echo: ${ev.message.text}` }]);
        replied = true;
      } catch (e) {
        // 失敗ログ
        try {
          await db.collection("logs").doc("errors").collection("items")
            .doc(Date.now().toString())
            .set({ at, type: "reply_fail", message: String(e) });
        } catch {}
      }
    }
  }

  return res.status(200).send(replied ? "echoed" : "ok");
}
