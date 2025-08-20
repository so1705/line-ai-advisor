// api/line-webhook.js
export const runtime = "edge";

import crypto from "node:crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { isAdvisorMode } from "../lib/richmenu.js";
import { buildAdvisorPrompt } from "../prompts/advisor.js";

// ==== ENV ====
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET ?? "";
const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN ?? "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const ADVISOR_RICHMENU_ID = process.env.ADVISOR_RICHMENU_ID ?? "";

// 署名検証（本番は true 推奨）
const ENFORCE_SIGNATURE = true;

// ==== Gemini ====
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// ==== util ====
function verify(request, raw) {
  try {
    const sig = request.headers.get("x-line-signature");
    if (!sig) return false;
    const h = crypto.createHmac("sha256", CHANNEL_SECRET);
    h.update(raw, "utf8");
    const digest = h.digest("base64");
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(digest));
  } catch {
    return false;
  }
}

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
    console.error("LINE reply error", { status: res.status, body });
  }
}

async function push(userId, text) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ to: userId, messages: [{ type: "text", text }] }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error("LINE push error", { status: res.status, body });
  }
}

export async function POST(request) {
  const raw = await request.text();

  // 署名検証
  if (ENFORCE_SIGNATURE && !verify(request, raw)) {
    console.warn("Signature validation failed");
    return new Response("Signature validation failed", { status: 401 });
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch (e) {
    console.error("JSON parse error", e);
    return new Response("Bad Request", { status: 400 });
  }

  const events = body?.events ?? [];
  for (const ev of events) {
    try {
      if (ev.type !== "message" || ev.message?.type !== "text") {
        console.log("Unhandled event", ev.type);
        continue;
      }

      const q = (ev.message?.text ?? "").trim();
      const userId = ev.source?.userId ?? null;

      // ① ACK（軽い返信）
      await reply(ev.replyToken, "受け付けました。少しお待ちください…");

      // 環境変数と呼び出し状況のログ（最小限）
      console.log("ENV check", {
        ADVISOR_RICHMENU_ID,
        tokenTail: CHANNEL_ACCESS_TOKEN?.slice(-8),
        userId,
      });

      // ② モード判定（ここが核心）
      const advisorOn = userId
        ? await isAdvisorMode(userId, CHANNEL_ACCESS_TOKEN, ADVISOR_RICHMENU_ID)
        : false;

      if (!advisorOn) {
        if (userId) {
          await push(userId, "AIアドバイザーを使うには、リッチメニューの『AI相談』をタップしてください。");
        }
        continue;
      }

      // ③ AI 回答
      try {
        const prompt = buildAdvisorPrompt(q);
        const r = await model.generateContent(prompt);
        const text = r?.response?.text?.() ?? "";

        if (!text) {
          console.warn("AI empty response");
          if (userId) await push(userId, "すみません、今は回答を生成できませんでした。もう一度お試しください。");
          continue;
        }
        await push(userId, text);
      } catch (e) {
        console.error("AI/push error", e);
        if (userId) await push(userId, "すみません、内部エラーが発生しました。時間をおいて再度お試しください。");
      }
    } catch (e) {
      console.error("Event handling error", e);
    }
  }

  return new Response("ok", { status: 200 });
}
