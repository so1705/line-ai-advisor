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

// ==== 追加: セッション（文脈/履歴）・ユーティリティ ====
const sessStore = globalThis.__flagsSess ??= new Map(); // userId -> { last_topic, pending_q, history: [{role,text}] }
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
function getSess(userId) {
  const s = sessStore.get(userId) || { last_topic: "", pending_q: "", history: [] };
  if (!Array.isArray(s.history)) s.history = [];
  return s;
}
function pushHist(sess, role, text) {
  sess.history.push({ role, text: clamp(text, 800) });
  // 直近6発言だけ保持（user/model 合算で6）
  if (sess.history.length > 6) sess.history = sess.history.slice(-6);
}
function normalizeShortInput(q, sess) {
  const isShort = q.length <= 8 || q.split(/\s+/).length <= 2;
  if (!isShort) return q;
  const lastAssistant = [...sess.history].reverse().find(h => h.role === "model")?.text || "";
  const pending = sess.pending_q || "";
  const topic = sess.last_topic || "";
  // 短文を“直前質問への回答キーワード”として明示した拡張入力にする
  return [
    `【短文回答の解釈】以下のユーザー入力「${q}」は、直前のあなたの問い「${pending || "（直前の問い不明）"}」`,
    `および直近のあなたの発話「${lastAssistant || "（直近発話なし）"}」に対する短い回答/キーワードです。`,
    `会話の主題は「${topic || "（主題未設定）"}」。これらの文脈を踏まえて解釈し、主題から逸れずに応答してください。`,
    `【ユーザーの短文入力】${q}`
  ].join("\n");
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

    const qRaw = (ev.message?.text ?? "").trim();

    // --- 3) （保険）手打ちでも切替できるように ---
    const onWords = ["AIアドバイザー"];
    const offWords = ["終了", "やめる", "メニュー"];

    if (userId && onWords.includes(qRaw)) {
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

    if (userId && offWords.includes(qRaw)) {
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
      const sess = userId ? getSess(userId) : { last_topic: "", pending_q: "", history: [] };
      const q = normalizeShortInput(qRaw, sess);

      const def = selectPrompt(qRaw, { abBucket: PROMPT_AB_BUCKET });
      const system = clamp(buildSystemPrompt(def, { text: qRaw, strict: PROMPT_STRICT }));

      // 会話履歴を contents に詰める（直近6発言）
      const histParts = sess.history.flatMap(h => {
        return [{ role: h.role === "model" ? "model" : "user", parts: [{ text: h.text }] }];
      });

      // ランタイムヒント（進路逸脱を防ぐ）
      const runtimeHint =
        `直前の主題:${sess.last_topic || "未設定"} / 直前のこちらの問い:${sess.pending_q || "なし"} / 入力種別:${q === qRaw ? "通常" : "短文拡張"}` +
        "。主題から逸れず、必要時のみ一問だけ確認。完結と判断したら丁寧に締めてもよい。";

      const contents = [
        ...histParts,
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

      // セッション更新：pending_q, last_topic, history
      const lastQ = text.split(/。|\n/).map(s => s.trim()).filter(s => /[?？]$/.test(s)).pop();
      sess.pending_q = lastQ || sess.pending_q;
      // 直近の主題は、通常入力のときだけ上書き
      const isShortLike = q !== qRaw;
      if (!isShortLike) sess.last_topic = qRaw;

      // 履歴：今回の user 入力と model 出力を積む
      pushHist(sess, "user", qRaw);
      pushHist(sess, "model", text);

      if (userId) sessStore.set(userId, sess);

      if (PROMPT_DEBUG) {
        console.log("gemini.meta", { finishReason: cand?.finishReason, hasCandidates: !!cand });
      }
    } catch (e) {
      console.error("AI error", { name: e?.name, status: e?.status, message: e?.message });
      if (userId) {
        const sess = getSess(userId);
        const hint = sess?.pending_q ? `（直前の問い:「${sess.pending_q}」へのご回答ですか？）` : "";
        await push(userId, `すみません、こちらでうまく処理できませんでした。${hint}一言で補足いただけると助かります。`);
      }
    }
  }

  return new Response("ok", { status: 200 });
}
