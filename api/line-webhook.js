// /api/line-webhook.js（完成版：即200維持＋AI応答）
import crypto from "node:crypto";
import { db } from "../lib/firestore.js";
import { replyMessage, pushMessage, MSG } from "../lib/line.js";
import { generateAdvice } from "../lib/ai.js";

export const config = { api: { bodyParser: false } };
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

function verifySignature(headers, raw, secret) {
  try {
    const sig = headers["x-line-signature"];
    if (!sig || !secret) return false;
    const mac = crypto.createHmac("sha256", secret).update(raw).digest("base64");
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(mac));
  } catch { return false; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).end(); return; }

  // まず即200
  res.status(200).send("ok");

  // 応答後に非同期処理
  let raw = "";
  req.setEncoding("utf8");
  req.on("data", c => (raw += c));
  req.on("end", async () => {
    const at = new Date().toISOString();
    try {
      const sigOK = verifySignature(req.headers, raw, CHANNEL_SECRET);

      let body = {}; try { body = JSON.parse(raw); } catch {}
      const events = Array.isArray(body.events) ? body.events : [];

      // 軽量ログ
      try {
        await db.collection("logs").doc("lastWebhook").set(
          { at, sigOK, sample: events[0] ?? null },
          { merge: true }
        );
      } catch {}

      if (!sigOK) {
        const rt = events[0]?.replyToken;
        if (rt) { try { await replyMessage(rt, MSG.SIGNATURE_NG); } catch {} }
        return;
      }

      for (const ev of events) {
        if (ev.type === "message" && ev.message?.type === "text") {
          const userId = ev?.source?.userId;
          const text = (ev.message.text || "").trim();

          // すぐACK
          if (ev.replyToken) { try { await replyMessage(ev.replyToken, MSG.ACK); } catch {} }

          // 本回答はpush
          try {
            const advice = await generateAdvice(text);
            await pushMessage(userId, [{ type: "text", text: advice }]);
          } catch (e) {
            await db.collection("logs").doc("errors").collection("items")
              .doc(Date.now().toString())
              .set({ at, type: "ai_error", message: String(e), input: text });
            await pushMessage(userId, [{ type: "text", text: "回答生成でエラーが発生しました。時間をおいてお試しください。" }]);
          }
        }
      }
    } catch (e) {
      await db.collection("logs").doc("errors").collection("items")
        .doc(Date.now().toString())
        .set({ at, type: "handler_exception", message: String(e), stack: e?.stack });
    }
  });
}
