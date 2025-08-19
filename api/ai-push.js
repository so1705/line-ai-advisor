// /api/ai-push.js
// - 認証: WORKER_KEY (Bearer または X-Worker-Key)
// - 入力: { to, text } を line-webhook から受ける
// - 処理: Gemini で回答生成 → LINE push でユーザーへ送信

import fetch from "node-fetch";
import { GoogleGenerativeAI } from "@google/generative-ai";

const WORKER_KEY = (process.env.WORKER_KEY || "").trim();
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// LINE Push API
async function pushToLine(to, text) {
  const resp = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      to,
      messages: [{ type: "text", text }],
    }),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    console.error("[ai-push] LINE push failed", resp.status, t);
    throw new Error(`LINE push failed: ${resp.status}`);
  }
}

export default async function handler(req, res) {
  try {
    // ---- 認証 ----
    const rawAuth =
      req.headers["authorization"] ||
      req.headers["Authorization"] ||
      req.headers["x-worker-key"] ||
      req.headers["X-Worker-Key"] ||
      "";
    const token = String(rawAuth).replace(/^Bearer\s+/i, "").trim();
    if (!WORKER_KEY || !token || token !== WORKER_KEY) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    // ---- body 取得 ----
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
    const to = body?.to;
    const userText = (body?.text || "").trim();
    if (!to || !userText) {
      return res.status(400).json({ ok: false, error: "missing to/text" });
    }

    // ---- Gemini 生成 ----
    const prompt =
      "あなたは就活アドバイザーです。ユーザーの質問に丁寧に答え、" +
      "最後に『次の一歩』を3つ提案してください。\n\n質問: " + userText;

    const result = await model.generateContent(prompt);
    const aiText = (await result.response.text()).slice(0, 4500) || "回答できませんでした。";

    // ---- LINEへpush ----
    await pushToLine(to, aiText);

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[ai-push] fatal", e);
    return res.status(500).json({ ok: false, error: "internal" });
  }
}
