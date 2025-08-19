// /api/line-webhook.js
// ✅ Nodeランタイムで生ボディを読み取り、必ず200を返す（検証通す目的）
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const chunks = [];
    await new Promise((resolve) => {
      req.setEncoding("utf8");
      req.on("data", (c) => chunks.push(c));
      req.on("end", resolve);
    });
    const raw = chunks.join("");
    console.log("[webhook:minimal] headers=", req.headers);
    console.log("[webhook:minimal] raw body=", raw);

    // 🔵 とにかく200を返す
    return res.status(200).send("ok");
  } catch (e) {
    console.error("[webhook:minimal] error:", e);
    // 検証を通すため、失敗しても200で返す
    return res.status(200).send("ok");
  }
}
