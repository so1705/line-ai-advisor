// /api/ai-push.js
import { generateAdvice } from "../lib/ai.js";
import { pushMessage } from "../lib/line.js";
import { db } from "../lib/firestore.js";

export const config = { runtime: "nodejs" };  // ← 修正！（"nodejs18.x" → "nodejs"）

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const key = req.headers["x-worker-key"];
  if (!key || key !== process.env.WORKER_KEY) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const { userId, text } = await readJson(req).catch(() => ({}));
  if (!userId || !text) return res.status(400).json({ ok: false, error: "missing fields" });

  try {
    const advice = await generateAdvice(text);
    await pushMessage(userId, [{ type: "text", text: advice }]);
    return res.status(200).json({ ok: true });
  } catch (e) {
    try {
      await db.collection("logs").doc("errors").collection("items")
        .doc(Date.now().toString())
        .set({ type: "ai_push_error", message: String(e), input: text });
    } catch {}
    return res.status(500).json({ ok: false, error: String(e) });
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8"))); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}
