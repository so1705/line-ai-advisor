// Nodeランタイム (Edge不可)
import crypto from "node:crypto";
import { getUserState, setUserState } from "@/lib/firestore";
import { replyMessage, pushMessage } from "@/lib/line";

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

// 署名検証
function verifySignature(req, rawBody) {
  const signature = req.headers["x-line-signature"];
  if (!signature) return false;
  const hmac = crypto.createHmac("sha256", CHANNEL_SECRET);
  hmac.update(rawBody);
  const digest = hmac.digest("base64");
  try { return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest)); }
  catch { return false; }
}

export const config = { api: { bodyParser: false } }; // 生ボディ取得

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  // 生ボディ取得
  let raw = "";
  await new Promise((resolve) => {
    req.setEncoding("utf8");
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", resolve);
  });

  // 署名チェック
  if (!verifySignature(req, raw)) {
    console.warn("Signature NG");
    return res.status(401).send("bad signature");
  }

  let body;
  try { body = JSON.parse(raw); } 
  catch (e) { console.error("JSON parse error", e); return res.status(400).send("bad body"); }

  const events = body?.events ?? [];
  for (const ev of events) {
    const userId = ev.source?.userId;

    try {
      // Postback: ai:toggle
      if (ev.type === "postback" && ev.postback?.data === "ai:toggle") {
        const state = (userId ? await getUserState(userId) : null) || { aiMode: "off" };
        const next = state.aiMode === "on" ? "off" : "on";
        if (userId) await setUserState(userId, { aiMode: next });
        await replyMessage(ev.replyToken, { type: "text", text: `AI面談を${next === "on" ? "開始" : "終了"}しました。` });
        continue;
      }

      // Text message
      if (ev.type === "message" && ev.message?.type === "text") {
        // 状態を確認
        const state = (userId ? await getUserState(userId) : null) || { aiMode: "off" };

        if (state.aiMode !== "on") {
          await replyMessage(ev.replyToken, { type: "text", text: "質問ありがとうございます。AI面談はメニューから開始できます。" });
          continue;
        }

        // まず軽く即返信（タイムアウト対策）
        await replyMessage(ev.replyToken, { type: "text", text: "受け付けました。少しお待ちください。" });

        // ★ここで本来はAIを呼ぶ。まずはダミー返答（短いテンプレ）
        const text = buildShortAnswer(ev.message.text);

        if (userId) {
          await pushMessage(userId, { type: "text", text });
        }
        continue;
      }

      // それ以外はログ
      console.log("Unhandled event", JSON.stringify(ev));
    } catch (e) {
      console.error("Event error", e);
      // replyToken は1回なのでここでは無理に返信しない
    }
  }

  return res.status(200).send("ok");
}

// 分量を常に短くまとめるダミー回答（本番はAIに差し替え）
function buildShortAnswer(q) {
  const tldr = `要点: ${q.slice(0, 60)}... への回答を簡潔にまとめます。`;
  const bullets = [
    "結論を先に：まず1つだけ行動する（例：企業研究のテンプレ作成）",
    "次に：30分でできるタスクに分解（3ステップ以内）",
    "最後に：今日のうちに1タスクを必ず完了",
  ];
  const next = "次の一歩：今から30分計測して、1社分の企業研究テンプレを作成。";
  return `${tldr}\n- ${bullets.join("\n- ")}\n${next}`;
}
