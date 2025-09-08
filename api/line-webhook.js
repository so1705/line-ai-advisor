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

// （重要）固定IDは使わない：常に alias で解決する
const ADVISOR_RICHMENU_ID = "";
const DEFAULT_RICHMENU_ID = "";

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

// ==== 追加: 簡易セッション/ユーティリティ（最小限） ====
const sessStore = globalThis.__flagsSess ??= new Map(); // key: userId -> { last_topic, pending_q }
const clamp = (s, n = 2500) => (typeof s === "string" && s.length > n ? s.slice(0, n) : s);
async function withRetry(fn, times = 2, delay = 400) {
  try { return await fn(); }
  catch (e) {
    const st = e?.status ?? e?.cause?.status;
    if (times > 0 && (st === 429 || (st >= 500 && st < 600))) {
      await new Promise(r => setTimeout(r, delay));
      return withRetry(fn, times - 1, delay * 2);
    }
    throw e;
  }
}

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
  // 常に alias を参照して ID を解決
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
    const onWords = ["AIアドバイザー"];
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

    // --- 4) AIモード中か？（alias 解決して判定）---
    const linked = userId ? await getLinkedRichMenuId(userId) : null;
    const advisorId = await resolveIdFromAlias("advisor_on").catch(() => "");
    const advisorOn = !!linked && !!advisorId && linked === advisorId;

    if (!advisorOn) continue;

    // --- 5) AIモード中のみ応答 ---
    try {
      // セッション/短文判定（追加済み）
      const sess = userId ? (sessStore.get(userId) || { last_topic: "", pending_q: "" }) : { last_topic: "", pending_q: "" };
      const isShort = q.length <= 8 || q.split(/\s+/).length <= 2;

      const def = selectPrompt(q, { abBucket: PROMPT_AB_BUCKET });
      const system = clamp(buildSystemPrompt(def, { text: q, strict: PROMPT_STRICT }));

      const runtimeHint =
        `直前の主題:${sess.last_topic || "未設定"} / 直前のこちらの問い:${sess.pending_q || "なし"} / ユーザー返答:${q} / 指示:` +
        (isShort ? "この返答は直前の問いへの短い回答として文脈をつないで解釈する。" : "通常どおり文脈を維持して解釈する。") +
        "主題から逸れない。必要時のみ一問だけ確認。完結と判断したら丁寧に締めてよい。";

      // ✅ system は systemInstruction で渡し、contents は user/model のみ
      const contents = [
        { role: "user", parts: [{ text: runtimeHint }] },
        { role: "user", parts: [{ text: q }] },
      ];

      const r = await withRetry(() => model.generateContent({
        contents,
        systemInstruction: { role: "system", parts: [{ text: system }] },
      }));

      const resp = r?.response;
      const cand = resp?.candidates?.[0];

      let text;
      if (!cand) {
        text = "うまく受け取れませんでした。要点を一言で教えてもらえますか？";
      } else if (cand.finishReason === "SAFETY") {
        text = "内容の一部が安全フィルタにかかったようです。言い換えてもう一度お願いします。";
      } else {
        text = resp.text();
      }

      if (userId) await push(userId, text);

      // pending_q / last_topic 更新（追加済み）
      const lastQ = text.split(/。|\n/).map(s => s.trim()).filter(s => /[?？]$/.test(s)).pop();
      sess.pending_q = lastQ || "";
      if (!isShort) sess.last_topic = q;
      if (userId) sessStore.set(userId, sess);

      if (PROMPT_DEBUG) {
        console.log("gemini.meta", { finishReason: cand?.finishReason, hasCandidates: !!cand });
      }
    } catch (e) {
      console.error("AI error", { name: e?.name, status: e?.status, message: e?.message });
      if (userId) {
        const sess = sessStore.get(userId) || {};
        const hint = sess?.pending_q ? `（直前の問い:「${sess.pending_q}」へのご回答ですか？）` : "";
        await push(userId, `すみません、こちらでうまく処理できませんでした。${hint}一言で補足いただけると助かります。`);
      }
    }
  }

  return new Response("ok", { status: 200 });
}
