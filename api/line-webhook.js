// /api/line-webhook.js（エコー版：まず確実に届くか検証）
import crypto from "node:crypto";
import { db } from "../lib/firestore.js";

export const config = { api: { bodyParser: false } };
export const runtime = "nodejs18.x";   // ★ Nodeで固定

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const BASE = "https://api.line.me/v2/bot";
const HEAD = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
});

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
  if (!res.ok) throw new Error(`LINE reply ${res.status}: ${await res.text()}`);
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).send("Method Not Allowed"); }

  // 1) 先に読み切る（署名は Buffer で計算）
  const raw = await readRaw(req);
  const at = new Date().toISOString();
  const sigOK = verifySignature(req.headers, raw, CHANNEL_SECRET);

  // 2) JSON化 + ラストログ
  let body = {}; try { body = JSON.parse(raw.toString("utf-8")); } catch {}
  const events = Array.isArray(body.events) ? body.events : [];
  try {
    await db.collection("logs").doc("lastWebhook").set(
      { at, sigOK, count: events.length, sample: events[0] ?? null },
      { merge: true }
    );
  } catch {}

  // 3) 署名NGでも検証は落とさない
  if (!sigOK) return res.status(200).send("ok");

  // 4) ここで“同期的に”エコー返信（PoCと同じ構え）
  let replied = false;
  for (const ev of events) {
    if (ev.type === "message" && ev.message?.type === "text" && ev.replyToken) {
      await replyMessage(ev.replyToken, [{ type: "text", text: `echo: ${ev.message.text}` }]);
      replied = true;
    }
  }

  // 5) 最後に200（すべて終えてから終了）
  return res.status(200).send(replied ? "echoed" : "ok");
}
