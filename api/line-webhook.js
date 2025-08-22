// /api/line-webhook.js
export const runtime = "edge";

import crypto from "node:crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { buildAdvisorPrompt } from "../prompts/advisor.js";
import { selectPrompt, buildSystemPrompt } from "../lib/promptRegistry.js";

// ==== ENV ====
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET ?? "";
const CHANNEL_ACCESS_TOKEN =
  process.env.CHANNEL_ACCESS_TOKEN ?? process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";

// リッチメニューID（未設定でも動くよう alias で解決）
const ADVISOR_RICHMENU_ID = process.env.ADVISOR_RICHMENU_ID ?? "";
const DEFAULT_RICHMENU_ID = process.env.DEFAULT_RICHMENU_ID ?? "";

// 署名検証
const ENFORCE_SIGNATURE = true;

// プロンプト系（任意）
const PROMPT_DEBUG = process.env.PROMPT_DEBUG === "1";
const PROMPT_AB_BUCKET = process.env.PROMPT_AB_BUCKET || "";
const PROMPT_STRICT = process.env.PROMPT_STRICT_MODE === "1";

// ==== Gemini ====
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

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

async function linkById(userId, richMenuId) {
  const url = `https://api.line.me/v2/bot/user/${userId}/richmenu/${richMenuId}`;
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`linkById(${richMenuId}) HTTP ${res.status} ${body}`);
  }
}

async function getLinkedRichMenuId(userId) {
  const url = `https://api.line.me/v2/bot/user/${userId}/richmenu`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` } });
  if (!res.ok) return null;
  const json = await res.json().catch(() => ({}));
  return json?.richMenuId ?? null;
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
    const userId = ev.source?.userId ?? null;

    // --- 1) リッチメニュー postback でモード切替 ---
    if (ev.type === "postback" && userId) {
      const data = ev.postback?.data || "";
      try {
        if (data.includes("mode=advisor_on")) {
          const id = await resolveIdFromAlias("advisor_on");
          await linkById(userId, id);
          await push(userId, "AIアドバイザーを開始します。質問をどうぞ！");
        } else if (data.includes("mode=default")) {
          const id = await resolveIdFromAlias("default");
          await linkById(userId, id);
          await push(userId, "通常メニューに戻しました。");
        }
      } catch (e) {
        console.error(e);
        await push(userId, "メニューの切り替えに失敗しました。時間をおいて再度お試しください。");
      }
      continue;
    }

    // --- 2) テキスト以外は無視 ---
    if (ev.type !== "message" || ev.message?.type !== "text") continue;

    const q = (ev.message?.text ?? "").trim();

    // --- 3) （保険）手打ちでも切替できるように ---
    const onWords = ["AIアドバイザー"]; // ← 不要なら空配列に
    const offWords = ["終了", "やめる", "メニュー"];

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

    // --- 4) AIモード中か？（env 未設定でも alias 解決して判定）---
    const linked = userId ? await getLinkedRichMenuId(userId) : null;
    const advisorId = ADVISOR_RICHMENU_ID || (await resolveIdFromAlias("advisor_on").catch(() => ""));
    const advisorOn = !!linked && !!advisorId && linked === advisorId;

    // 非AIモード時は完全スルー（誘導しない）
    if (!advisorOn) continue;

    // --- 5) AIモード中のみ応答 ---
    try {
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
