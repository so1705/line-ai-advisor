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

// v1 と同じ “エイリアスで切替” を使う
const DEFAULT_ALIAS_ID = "default";
const ADVISOR_ALIAS_ID = "advisor_on";

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

// ▼▼ v1 と同じ「ユーザーごとに alias を付け替える」関数を追加
const linkAlias = async (userId, aliasId) => {
  const url = `https://api.line.me/v2/bot/user/${userId}/richmenu/alias/${aliasId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`linkAlias(${aliasId}) HTTP ${res.status} ${body}`);
  }
};
// ▲▲

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

      // ① まず軽い ACK
      await reply(ev.replyToken, "受け付けました。少しお待ちください…");

      // ログ（トークン末尾と AI モード確認に使う ID）
      console.log("ENV check", {
        ADVISOR_RICHMENU_ID,
        tokenTail: CHANNEL_ACCESS_TOKEN?.slice(-8),
        userId,
      });

      // ② 「AIアドバイザー」を v1 と同じ手順で ON（alias 付替）
      const onWords = ["AIアドバイザー", "AI相談", "AI面談"];
      const offWords = ["終了", "やめる", "メニュー"];

      if (userId && onWords.includes(q)) {
        try {
          await linkAlias(userId, ADVISOR_ALIAS_ID); // ← v1 と同じ
          await push(userId, "AIアドバイザーを開始します。質問をどうぞ。");
        } catch (e) {
          console.error(e);
          await push(userId, "メニューの切り替えに失敗しました。時間をおいて再度お試しください。");
        }
        continue; // ON コマンドはここで終了
      }

      // ③ OFF（通常メニューへ戻す）
      if (userId && offWords.includes(q)) {
        try {
          await linkAlias(userId, DEFAULT_ALIAS_ID); // ← v1 と同じ
          await push(userId, "通常メニューに戻しました。");
        } catch (e) {
          console.error(e);
          await push(userId, "メニューの切り替えに失敗しました。時間をおいて再度お試しください。");
        }
        continue; // OFF コマンドはここで終了
      }

      // ④ いま AI モードか判定（※v1 と同様、リンク中の richmenuId を参照）
      const advisorOn = userId
        ? await isAdvisorMode(userId, CHANNEL_ACCESS_TOKEN, ADVISOR_RICHMENU_ID)
        : false;

      if (!advisorOn) {
        // まだ ON じゃないときの通常応答
        if (userId) {
          await push(userId, "AIアドバイザーを使うには、リッチメニューの『AI相談』をタップしてください。");
        }
        continue;
      }

      // ⑤ AI回答（v1 のまま）
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
