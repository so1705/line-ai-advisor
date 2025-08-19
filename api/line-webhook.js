// api/line-webhook.js
import crypto from "node:crypto";
import fetch from "node-fetch";

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const WORKER_KEY = (process.env.WORKER_KEY || "").trim();

// 署名検証には生ボディ必須
export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function verifySignature(req, rawBody) {
  const sig = req.headers["x-line-signature"];
  if (!sig || !CHANNEL_SECRET) return false;
  const hmac = crypto.createHmac("sha256", CHANNEL_SECRET);
  hmac.update(rawBody, "utf8");
  return sig === hmac.digest("base64");
}

async function replyToLine(replyToken, text) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
  }).catch((e) => console.error("[webhook] reply failed", e));
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const rawBody = await readRawBody(req);
    if (!verifySignature(req, rawBody)) {
      return res.status(401).send("Signature validation failed");
    }

    // 先にACK（LINEのタイムアウト回避）
    res.status(200).send("OK");

    // 受付返信（任意）
    let body = {};
    try { body = JSON.parse(rawBody); } catch {}
    const ev = Array.isArray(body?.events) ? body.events.find(e => e?.type === "message") : null;
    if (ev?.replyToken) {
      replyToLine(ev.replyToken, "受け付けました。AIが回答を作成中です…");
    }

    // ai-push へ委譲（to と text だけを渡す：Push API 用）
    const to =
      ev?.source?.userId || ev?.source?.groupId || ev?.source?.roomId || "";
    const text = ev?.message?.type === "text" ? (ev?.message?.text || "") : "";

    if (to && text) {
      const baseURL = `https://${req.headers["host"]}`;
      fetch(`${baseURL}/api/ai-push`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${WORKER_KEY}`,
        },
        body: JSON.stringify({ to, text }),
      }).catch((e) => console.error("[webhook] delegate error", e));
    }
  } catch (e) {
    console.error("[webhook] fatal", e);
    try { res.status(200).send("OK"); } catch {}
  }
}
