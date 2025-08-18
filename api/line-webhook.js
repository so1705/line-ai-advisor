import crypto from "node:crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// 署名検証
function verify(req, raw) {
  const sig = req.headers.get("x-line-signature");
  if (!sig) return false;
  const h = crypto.createHmac("sha256", CHANNEL_SECRET);
  h.update(raw, "utf8");
  const digest = h.digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(digest));
  } catch { return false; }
}

// LINE返信
async function reply(replyToken, text) {
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
  });
  if (!res.ok) console.error("LINE reply error:", res.status, await res.text());
}

// ★ Web API 形式
export async function POST(request) {
  const raw = await request.text();

  if (!verify(request, raw)) {
    return new Response("Signature validation failed", { status: 401 });
  }

  const body = JSON.parse(raw);
  const events = body?.events ?? [];
  for (const ev of events) {
    if (ev.type === "message" && ev.message?.type === "text") {
      const q = ev.message.text?.trim() ?? "";
      try {
        const r = await model.generateContent(
          "あなたは就活アドバイザー。分かりやすく、次の一歩を3つ提案してください。\n\n質問:" + q
        );
        const text = (r.response.text() ?? "").slice(0, 4500) || "うまく応答できませんでした。";
        await reply(ev.replyToken, text);
      } catch (e) {
        console.error(e);
        await reply(ev.replyToken, "内部エラーが発生しました。");
      }
    }
  }
  return new Response("ok", { status: 200 });
}
