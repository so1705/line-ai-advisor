// /api/line-webhook.js
export const runtime = "edge";

import { GoogleGenerativeAI } from "@google/generative-ai";

// 追加: モード判定＆プロンプト
import { isAdvisorMode } from "../lib/richmenu.js";
import { buildAdvisorPrompt } from "../prompts/advisor.js";

// ==== Env ====
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET ?? "";
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";

// 追加: AIメニュー（リッチメニューB）のID
const ADVISOR_RICHMENU_ID = process.env.ADVISOR_RICHMENU_ID ?? "";

// デバッグ期間中は false（通ることを確認できたら true に戻す）
const ENFORCE_SIGNATURE = false;

// ==== Gemini ====
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// ==== Utils ====

// Edge(Web Crypto)での LINE 署名検証
const te = new TextEncoder();
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

    // constant-time 風比較
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

  // 署名チェック（デバッグ中はスキップ可）
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

        // 1) すぐ軽いACKを返す（タイムアウト回避）
        await reply(ev.replyToken, "受け付けました。少しお待ちください…");

        // 2) AIモードかどうか判定（A: richmenuswitch 方式）
        const advisorOn = await isAdvisorMode(
          userId,
          CHANNEL_ACCESS_TOKEN,
          ADVISOR_RICHMENU_ID
        );

        if (!advisorOn) {
          // 通常モード：AIは動かさず、案内のみ
          if (userId) {
            await push(
              userId,
              "AIアドバイザーを使うには、リッチメニューの『AI相談』をタップしてください。"
            );
          }
          continue;
        }

        // 3) AI回答（モードONのときのみ）
        if (userId) {
          const prompt = buildAdvisorPrompt(q);
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
