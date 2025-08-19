import fetch from "node-fetch";
import { GoogleGenerativeAI } from "@google/generative-ai";

const WORKER_KEY = (process.env.WORKER_KEY || "").trim();
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

async function replyToLine(replyToken, text) {
  const resp = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    console.error("[ai-push] LINE reply failed", resp.status, t);
    throw new Error(`LINE reply failed: ${resp.status}`);
  }
}

export default async function handler(req, res) {
  try {
    // WORKER_KEY 認証（Bearer / x-worker-key 両対応）
    const rawAuth =
      req.headers["authorization"] ||
      req.headers["Authorization"] ||
      req.headers["x-worker-key"] ||
      req.headers["X-Worker-Key"] || "";
    const token = String(rawAuth).replace(/^Bearer\s+/i, "").trim();
    if (!WORKER_KEY || !token || token !== WORKER_KEY) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    // WebhookのJSON
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
    const events = Array.isArray(body?.events) ? body.events : [];
    if (!events.length) return res.status(200).json({ ok: true, note: "no events" });

    // 最初のテキストメッセージだけ応答（必要ならループ化）
    const ev = events.find(e => e?.type === "message" && e?.message?.type === "text");
    if (!ev) return res.status(200).json({ ok: true, note: "no text message" });

    const userText = ev.message.text || "";
    const prompt =
      "あなたは就活アドバイザーです。ユーザーの質問に丁寧に答え、" +
      "最後に『次の一歩』を3つ提案してください。\n\n質問: " + userText;

    const result = await model.generateContent(prompt);
    const aiText = (await result.response.text()).slice(0, 4500) || "回答できませんでした。";

    await replyToLine(ev.replyToken, aiText);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[ai-push] fatal", e);
    return res.status(500).json({ ok: false, error: "internal" });
  }
}
