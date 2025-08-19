import crypto from "node:crypto";
import fetch from "node-fetch";

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const WORKER_KEY = (process.env.WORKER_KEY || "").trim();

// 署名検証には「生ボディ」必須
export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function verifySignature(req, rawBody) {
  const sig = req.headers["x-line-signature"];
  if (!sig || !CHANNEL_SECRET) return false;
  const hmac = crypto.createHmac("sha256", CHANNEL_SECRET);
  hmac.update(rawBody, "utf8");
  return sig === hmac.digest("base64");
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const rawBody = await readRawBody(req);
    if (!verifySignature(req, rawBody)) return res.status(401).send("Signature validation failed");

    // 先にACK（タイムアウト回避）
    res.status(200).send("OK");

    // 同一ホストの ai-push に、生ボディのまま委譲
    const baseURL = `https://${req.headers["host"]}`;
    fetch(`${baseURL}/api/ai-push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${WORKER_KEY}`,
      },
      body: rawBody,
    }).catch((e) => console.error("[webhook] delegate error", e));
  } catch (e) {
    console.error("[webhook] fatal", e);
    try { res.status(200).send("OK"); } catch {}
  }
}
