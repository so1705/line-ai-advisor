import crypto from "node:crypto";
import fetch from "node-fetch";
import { GoogleGenerativeAI } from "@google/generative-ai";

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

function verifySignature(request, rawBody) {
  const signature = request.headers.get("x-line-signature");
  const hmac = crypto.createHmac("sha256", CHANNEL_SECRET);
  hmac.update(rawBody, "utf8");
  const digest = hmac.digest("base64");
  return signature === digest;
}

async function replyToLine(replyToken, text) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${CHANNEL_ACCESS_TOKEN}`
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text }]
    })
  });
}

export async function POST(request) {
  const rawBody = await request.text();
  if (!verifySignature(request, rawBody)) {
    return new Response("Signature validation failed", { status: 401 });
  }

  const body = JSON.parse(rawBody);
  const events = body.events || [];

  for (const ev of events) {
    if (ev.type === "message" && ev.message.type === "text") {
      const userText = ev.message.text;

      const prompt = `あなたは就活アドバイザーです。ユーザーの質問に丁寧に答え、次の一歩を3つ提案してください。\n\n質問: ${userText}`;
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const aiText = response.text().slice(0, 4500);

      await replyToLine(ev.replyToken, aiText || "回答できませんでした。");
    }
  }

  return new Response("OK", { status: 200 });
}
