// /api/line-webhook.js
export const runtime = "edge";

import { GoogleGenerativeAI } from "@google/generative-ai";

// ==== Env ====
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET ?? "";
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";

// デバッグ期間中は false（通ることを確認できたら true に戻す）
const ENFORCE_SIGNATURE = false;

// ==== Gemini ====
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// ==== Utils ====
const te = new TextEncoder();

// Edge(Web Crypto)での LINE 署名検証
async function verify(request, rawBody) {
  const sigHeader = request.headers.get("x-line-signature");
  if (!sigHeader) return false;

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      te.encode(CHANNEL_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = await crypto.subtle.sign("HMAC", key, te.encode(rawBody));
    const expected = btoa(
      String.fromCharCode(...new Uint8Array(signature))
    );

    // constant-time 比較（長さが違えば不一致）
    if (expected.length !== sigHeader.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ sigHeader.charCodeAt(i);
    }
    return diff === 0;
  } catch {
    return false;
  }
}

// 返信（reply）API
async function reply(replyToken, text) {
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
    const body = await res.text().catch(() => "");
    console.error("LINE reply error:", res.status, body);
  }
}

// push API
async function push(userId, text) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      to: userId,
      messages: [{ type: "text", text }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("LINE push error:", res.status, body);
  }
}

export async function POST(request) {
  const raw = await request.text();

  // 署名チェック（デバッグ中はスキップ可能）
  if (ENFORCE_SIGNATURE) {
    const ok = await verify(request, raw);
    if (!ok) {
      console.warn("Signature validation failed");
      return new Response("Signature validation failed", { status: 400 });
    }
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
        const userId = ev.source?.userId ?? null;
        const q = (ev.message.text ?? "").trim();

        // 1) まず軽いACKをすぐ返す（タイムアウト回避）
        await reply(ev.replyToken, "受け付けました。少しお待ちください…");

        // 2) 本回答は push で送る（ユーザーIDがあれば）
        if (userId) {
          // Gemini で生成
          const prompt = `あなたは就活アドバイザーです。質問者にとって分かりやすく、次に取るべき一歩まで具体的に答えてください。\n\nユーザーの質問: ${q}`;
          const r = await model.generateContent(prompt);
          const text =
            r?.response?.text?.() ??
            "すみません、少し混み合っています。もう一度お試しください。";

          await push(userId, text);
        }
      } else {
        // 未対応イベントもログに残す
        console.log("Unhandled event:", JSON.stringify(ev));
      }
    } catch (e) {
      console.error("Event handling error:", e);
      // replyToken は1回しか使えないためここでは返さない
    }
  }

  return new Response("ok", { status: 200 });
}
