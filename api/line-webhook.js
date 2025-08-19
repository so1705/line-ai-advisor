// /api/line-webhook.js
import crypto from "node:crypto";
import { db } from "../lib/firestore.js";

export const config = { api: { bodyParser: false } };
export const runtime = "nodejs18.x";

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_BASE = "https://api.line.me/v2/bot";
const LINE_HEAD = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
});

// どちらか存在する方に当たればOK
const ORIGIN = `https://${process.env.VERCEL_URL || "line-ai-advisor.vercel.app"}`;
const WORKER_PATHS = ["/api/ai-push"];

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
  } catch {
    return false;
  }
}

async function replyMessage(replyToken, messages) {
  const res = await fetch(`${LINE_BASE}/message/reply`, {
    method: "POST",
    headers: LINE_HEAD(),
    body: JSON.stringify({ replyToken, messages: [].concat(messages) }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`LINE reply ${res.status}: ${t}`);
  }
}

async function logError(payload) {
  try {
    await db.collection("logs").doc("errors").collection("items")
      .doc(Date.now().toString()).set(payload);
  } catch {}
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method Not Allowed");
  }

  const raw = await readRaw(req);
  const at = new Date().toISOString();
  const sigOK = verifySignature(req.headers, raw, CHANNEL_SECRET);

  let body = {};
  try { body = JSON.parse(raw.toString("utf-8")); } catch {}
  const events = Array.isArray(body.events) ? body.events : [];

  // 直近ログ
  try {
    await db.collection("logs").doc("lastWebhook")
      .set({ at, sigOK, count: events.length, sample: events[0] ?? null }, { merge: true });
  } catch {}

  // 署名NGでも200は返して終わり（安定運用）
  if (!sigOK) return res.status(200).send("ok");

  // (A) 即ACK（返信トークンで軽い返事）
  for (const ev of events) {
    if (ev.type === "message" && ev.message?.type === "text" && ev.replyToken) {
      try {
        await replyMessage(ev.replyToken, [{ type: "text", text: "受け付けました。少々お待ちください。" }]);
      } catch (e) {
        await logError({ at, type: "reply_fail", message: String(e) });
      }
    }
  }

  // Webhookはここで終了（タイムアウト回避）
  res.status(200).send("ok");

  // (B) 本回答はワーカーに委譲（/_ai-push と /ai-push の両方を順に試す）
  for (const ev of events) {
    if (ev.type === "message" && ev.message?.type === "text") {
      const userId = ev?.source?.userId;
      const text = (ev.message.text || "").trim();
      if (!userId || !text) continue;

      try {
        let called = false;
        for (const path of WORKER_PATHS) {
          const r = await fetch(`${ORIGIN}${path}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Worker-Key": process.env.WORKER_KEY || "",
            },
            body: JSON.stringify({ userId, text }),
          });
          if (r.ok) { called = true; break; }
          const t = await r.text().catch(() => "");
          await logError({ at, type: "ai_push_call_fail", path, status: r.status, body: t.slice(0, 500) });
        }
        if (!called) {
          // どちらのパスも失敗：ログだけ残す
        }
      } catch (e) {
        await logError({ at, type: "ai_push_fetch_error", message: String(e) });
      }
    }
  }
}
