// （変更差分の要点だけ。ファイル全体を置換してOK）
import crypto from "node:crypto";
import { db } from "../lib/firestore.js";

export const config = { api: { bodyParser: false } };
export const runtime = "nodejs18.x";

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const WORKER_ENDPOINT_HEADER = () => ({
  "Content-Type": "application/json",
  "X-Worker-Key": process.env.WORKER_KEY || "",
});
const LINE_BASE = "https://api.line.me/v2/bot";
const LINE_HEAD = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
});

function readRaw(req) { /* ← いまのまま */ }
function verifySignature(headers, rawBuf, secret) { /* ← いまのまま */ }

async function replyMessage(replyToken, messages) {
  const res = await fetch(`${LINE_BASE}/message/reply`, {
    method: "POST",
    headers: LINE_HEAD(),
    body: JSON.stringify({ replyToken, messages: [].concat(messages) }),
  });
  if (!res.ok) throw new Error(`LINE reply ${res.status}: ${await res.text()}`);
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow","POST"); return res.status(405).send("Method Not Allowed"); }

  // 1) 読み切り & 署名検証
  const raw = await readRaw(req);
  const at = new Date().toISOString();
  const sigOK = verifySignature(req.headers, raw, CHANNEL_SECRET);

  // 2) JSON化＋ログ
  let body = {}; try { body = JSON.parse(raw.toString("utf-8")); } catch {}
  const events = Array.isArray(body.events) ? body.events : [];
  try { await db.collection("logs").doc("lastWebhook").set({ at, sigOK, count: events.length, sample: events[0] ?? null }, { merge: true }); } catch {}

  // 3) 署名NGは即200
  if (!sigOK) return res.status(200).send("ok");

  // 4) 同期ACK（ここでユーザーに“受け付けました”）
  for (const ev of events) {
    if (ev.type === "message" && ev.message?.type === "text" && ev.replyToken) {
      try {
        await replyMessage(ev.replyToken, [{ type: "text", text: "受け付けました。少々お待ちください。" }]);
      } catch {}
    }
  }

  // 5) ここでWebhookは終了（200）
  res.status(200).send("ok");

  // 6) AI生成＋pushは別関数へ fire-and-forget
  const origin = getOrigin(req);
  for (const ev of events) {
    if (ev.type === "message" && ev.message?.type === "text") {
      const userId = ev?.source?.userId;
      const text = (ev.message.text || "").trim();
      if (!userId || !text) continue;

      fetch(`${origin}/api/_ai-push`, {
        method: "POST",
        headers: WORKER_ENDPOINT_HEADER(),
        body: JSON.stringify({ userId, text }),
      }).catch(() => {});
    }
  }
}

function getOrigin(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = (req.headers["x-forwarded-proto"] || "https");
  return `${proto}://${host}`;
}
