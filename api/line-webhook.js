// /api/line-webhook.js  (ESM, Nodeランタイム)
/** 検証通過用：即200だけ返す */
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }
  // ここで即応答（タイムアウト防止）
  res.status(200).send("ok");
}
