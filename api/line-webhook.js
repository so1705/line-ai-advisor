// api/line-webhook.js
import crypto from "node:crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

function verifyLineSignature(req, rawBody) {
  const signature = req.headers.get("x-line-signature");
  if (!signature) return false;
  const hmac = crypto.createHmac("sha256", CHANNEL_SECRET);
  hmac.update(rawBody, "utf8");
  const digest = hmac.digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
  } catch {
    return false;
  }
}

async function replyToLine(replyToken, text) {
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error("LINE reply error:", res.status, err);
  }
}

export async function POST(request) {
  const rawBody = await request.text();

  if (!verifyLineSignature(request, rawBody)) {
    console.error("Signature verify failed");
    return new Response("Signature validation failed", { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const events = payload.events ?? [];

  for (const ev of events) {
    if (ev.type === "message" && ev.message?.type === "text") {
      const userText = ev.message.text?.trim() ?? "";
      const prompt =
        "あなたは就活アドバイザーです。分かりやすく、次の一歩を3つ提案してください。\n\n質問: " +
        userText;

      try {
        const result = await model.generateContent(prompt);
        const text = (result.response.text() ?? "").slice(0, 4500) ||
          "すみません、うまく応答できませんでした。";
        await replyToLine(ev.replyToken, text);
      } catch (e) {
        console.error("Gemini error:", e);
        await replyToLine(ev.replyToken, "内部エラーが発生しました。");
      }
    }
  }

  return new Response("ok", { status: 200 });
}
