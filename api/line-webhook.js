// /api/line-webhook.js
export const runtime = "edge";

import crypto from "node:crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { buildAdvisorPrompt } from "../prompts/advisor.js";
import { selectPrompt, buildSystemPrompt } from "../lib/promptRegistry.js";

// ==== ENV ====
// どちらのキー名でも動くようフォールバック
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET ?? "";
const CHANNEL_ACCESS_TOKEN =
  process.env.CHANNEL_ACCESS_TOKEN ?? process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";

// 重要：IDでリンクするため（alias未設定でも動くように）
const ADVISOR_RICHMENU_ID = process.env.ADVISOR_RICHMENU_ID ?? "";
const DEFAULT_RICHMENU_ID = process.env.DEFAULT_RICHMENU_ID ?? "";

// 署名検証（本番は true 推奨）
const ENFORCE_SIGNATURE = true;

// 任意フラグ
const PROMPT_DEBUG = process.env.PROMPT_DEBUG === "1";
const PROMPT_AB_BUCKET = process.env.PROMPT_AB_BUCKET || ""; // 例: 'industry'
const PROMPT_STRICT = process.env.PROMPT_STRICT_MODE === "1";

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

/** 現在リンクされている richmenuId を取得 */
async function getLinkedRichMenuId(userId) {
  const url = `https://api.line.me/v2/bot/user/${userId}/richmenu`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` } });
  if (!res.ok) return null;
  const json = await res.json().catch(() => ({}));
  return json?.richMenuId ?? null;
}

/** richmenuId でユーザーにリンク */
async function linkById(userId, richMenuId) {
  const url = `https://api.line.me/v2/bot/user/${userId}/richmenu/${richMenuId}`;
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`linkById(${richMenuId}) HTTP ${res.status} ${body}`);
  }
}

/** alias → id の解決（DEFAULT_RICHMENU_ID 未設定でも動くよう保険） */
async function resolveIdFromAlias(aliasId) {
  if (aliasId === "advisor_on" && ADVISOR_RICHMENU_ID) return ADVISOR_RICHMENU_ID;
  if (aliasId === "default" && DEFAULT_RICHMENU_ID) return DEFAULT_RICHMENU_ID;

  const url = "https://api.line.me/v2/bot/richmenu/alias/list";
  const res = await fetch(url, { headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` } });
  if (!res.ok) throw new Error(`alias/list HTTP ${res.status}`);
  const json = await res.json().catch(() => ({}));
  const hit = (json?.aliases ?? []).find(a => a.richMenuAliasId === aliasId);
  if (!hit?.richMenuId) throw new Error(`alias not found: ${aliasId}`);
  return hit.richMenuId;
}

export async function POST(request) {
  const raw = await request.text();

  if (ENFORCE_SIGNATURE && !verify(request, raw)) {
    return new Response("Signature validation failed", { status: 401 });
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const events = body?.events ?? [];
  for (const ev of events) {
    if (ev.type !== "message" || ev.message?.type !== "text") continue;

    const q = (ev.message?.text ?? "").trim();
    const userId = ev.source?.userId ?? null;

    // ACK
    await reply(ev.replyToken, "分析中です。少しお待ちください…");

    // 切替コマンド（人力保険）
    const onWords = ["AIアドバイザー", "AI相談", "AI面談"];
    const offWords = ["終了", "やめる", "メニュー"];

    // ON
    if (userId && onWords.includes(q)) {
      try {
        const id = await resolveIdFromAlias("advisor_on");
        await linkById(userId, id);
        await push(userId, "AIアドバイザーを開始します。質問をどうぞ！");
      } catch (e) {
        console.error(e);
        await push(userId, "メニューの切り替えに失敗しました。時間をおいて再度お試しください。");
      }
      continue;
    }

    // OFF
    if (userId && offWords.includes(q)) {
      try {
        const id = await resolveIdFromAlias("default");
        await linkById(userId, id);
        await push(userId, "通常メニューに戻しました。");
      } catch (e) {
        console.error(e);
        await push(userId, "メニューの切り替えに失敗しました。時間をおいて再度お試しください。");
      }
      continue;
    }

    // いま advisor 中か（ID比較）
    const linked = userId ? await getLinkedRichMenuId(userId) : null;
    const advisorOn = !!linked && (linked === ADVISOR_RICHMENU_ID);

    if (!advisorOn) {
      if (userId) {
        await push(userId, "AIアドバイザーを使うには、下の『AI面談スタート』をタップしてください。");
      }
      continue;
    }

    // ==== AI回答 ====
    try {
      // プロンプト選択＋自動トーン/分量
      const def = selectPrompt(q, { abBucket: PROMPT_AB_BUCKET });
      const system = buildSystemPrompt(def, { text: q, strict: PROMPT_STRICT });

      const prompt = buildAdvisorPrompt(q, system);
      const r = await model.generateContent(prompt);
      const text = r?.response?.text?.() ?? "すみません、もう一度お試しください。";

      const decorated = PROMPT_DEBUG ? `[mode:${def.id}] ${text}` : text;
      if (userId) await push(userId, decorated);
    } catch (e) {
      console.error("AI error", e);
      if (userId) await push(userId, "すみません、内部エラーが発生しました。時間をおいて再度お試しください。");
    }
  }

  return new Response("ok", { status: 200 });
}
