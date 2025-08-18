export const runtime = "edge";

import crypto from "node:crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// デバッグ用：最初は false にして署名を必須にしない（疎通確認できたら true に戻す）
const ENFORCE_SIGNATURE = false;

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// 署名検証
function verify(request, raw) {
  const sig = request.headers.get("x-line-signature");
  if (!sig) return false;
  const h = crypto.createHmac("sha256", CHANNEL_SECRET);
  h.update(raw, "utf8");
  const digest = h.digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(digest));
  } catch {
    return false;
  }
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
  if (!res.ok) {
    const body = await res.text();
    console.error("LINE reply error:", res.status, body);
  }
}

export async function POST(request) {
  const raw = await request.text();

  // 署名チェック（デバッグ期間はスキップ可）
  if (ENFORCE_SIGNATURE && !verify(request, raw)) {
    console.warn("Signature validation failed");
    return new Response("Signature validation failed", { status: 401 });
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch (e) {
    console.error("JSON parse error:", e);
    return new Response("Bad Request", { status: 400 });
  }

  const events = body?.events ?? [];
  for (const ev of events) {
    try {
      if (ev.type === "message" && ev.message?.type === "text") {
        const q = (ev.message.text ?? "").trim();

        // 1) すぐ返す（タイムアウト回避用の軽い文）
        await reply(ev.replyToken, "受け付けました。少しお待ちください。");

        // 2) その後の内容は push で送る（ユーザーIDが必要）
        //    ※ まずは reply だけで十分なら、下の push を省略して reply に一本化でもOK
        const userId = ev.source?.userId;
        if (userId) {
          const r = await model.generateContent(
            "あなたは就活アドバイザー。分かりやすく、次の一歩を3つ提案してください。\n\n質問:" + q
          );
          const text = (r.response.text() ?? "").slice(0, 4500) || "うまく応答できませんでした。";

          // push 送信
          await fetch("https://api.line.me/v2/bot/message/push", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
            },
            body: JSON.stringify({ to: userId, messages: [{ type: "text", text }] }),
          });
        }
      } else {
        // 未対応イベントは無視せずログに残す
        console.log("Unhandled event:", JSON.stringify(ev));
      }
    } catch (e) {
      console.error("Event handling error:", e);
      // replyToken は 1回しか使えないので、ここでの追加返信は基本しない
    }
  }
  return new Response("ok", { status: 200 });
}
