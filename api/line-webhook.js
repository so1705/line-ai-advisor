// /api/line-webhook.js  ※Edgeは絶対に使わない
import crypto from "node:crypto";
import { db, getUserState, setUserState } from "../lib/firestore.js";
import { replyMessage, pushMessage } from "../lib/line.js";

export const config = { api: { bodyParser: false } }; // 生ボディで受ける

function verifySignature(headers, raw, secret) {
  try {
    const sig = headers["x-line-signature"];
    if (!sig || !secret) return false;
    const mac = crypto.createHmac("sha256", secret).update(raw).digest("base64");
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(mac));
  } catch {
    return false;
  }
}
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  let raw = "";
  try {
    // 生ボディ取得
    await new Promise((resolve) => {
      req.setEncoding("utf8");
      req.on("data", (c) => (raw += c));
      req.on("end", resolve);
    });

    // 署名（失敗しても落とさずログのみ／常に200で返す設計）
    const sigOK = verifySignature(req.headers, raw, CHANNEL_SECRET);
    if (!sigOK) console.warn("[webhook] signature NG");

    // JSON化（失敗は握りつぶし）
    let body = {};
    try { body = JSON.parse(raw); } catch {}

    const events = Array.isArray(body.events) ? body.events : [];
    for (const ev of events) {
      const userId = ev?.source?.userId;

      // 1) Postback: ai:toggle（1枠リッチメニュー用）
      if (ev.type === "postback" && ev.postback?.data === "ai:toggle") {
        try {
          const cur = userId ? await getUserState(userId) : { aiMode: "off" };
          const next = cur.aiMode === "on" ? "off" : "on";
          if (userId) await setUserState(userId, { aiMode: next });
          await replyMessage(ev.replyToken, { type: "text", text: `AI面談を${next === "on" ? "開始" : "終了"}しました。` });
        } catch (e) {
          console.error("[toggle] err:", e);
          try { await replyMessage(ev.replyToken, { type: "text", text: "切り替えに失敗しました。時間をおいてお試しください。" }); } catch {}
        }
        continue;
      }

      // 2) テキストメッセージ：aiMode=on の時だけ短文回答（AIはSTEP3で差し替え）
      if (ev.type === "message" && ev.message?.type === "text") {
        try {
          const state = userId ? await getUserState(userId) : { aiMode: "off" };
          if (state.aiMode !== "on") {
            await replyMessage(ev.replyToken, { type: "text", text: "AI面談はメニューから開始できます。" });
            continue;
          }

          // 即返信（タイムアウト回避）
          await replyMessage(ev.replyToken, { type: "text", text: "受け付けました。少しお待ちください。" });

          // 短文テンプレ（後でAIに置換）
          const text = buildShort(ev.message.text);
          if (userId) await pushMessage(userId, { type: "text", text });
        } catch (e) {
          console.error("[text] err:", e);
        }
        continue;
      }

      // 未対応イベントは軽くログ
      console.log("[unhandled] ", ev?.type);
    }

    // Firestoreに最後のhitログ（任意）
    try {
      await db.collection("logs").doc("lastWebhook").set(
        { at: new Date().toISOString(), lastEvent: events[0]?.type || "none" },
        { merge: true }
      );
    } catch (e) {
      console.error("[log] firestore err (ignored):", e);
    }

    // 検証/本番とも常に200（内部エラーで500にしない方針）
    return res.status(200).send("ok");
  } catch (e) {
    console.error("[webhook] fatal:", e);
    return res.status(200).send("ok");
  }
}

function buildShort(q) {
  const tldr = `要点: 「${q.slice(0, 60)}」への回答を簡潔にまとめます。`;
  return `${tldr}
- まず1アクションに絞る
- 30分で終わる形に分解
- 今日中に1つだけ完了
次の一歩：今から30分計測して1タスクを終える`;
}
