// pages/api/ai-push.js
export default async function handler(req, res) {
  // 1) 取得：Authorization と x-worker-key の両方を許可
  const rawHeader =
    req.headers['authorization'] ||
    req.headers['Authorization'] ||
    req.headers['x-worker-key'] ||
    req.headers['X-Worker-Key'] ||
    '';

  // 2) 正規化：Bearer を外し、前後空白を除去
  const token = String(rawHeader).replace(/^Bearer\s+/i, '').trim();

  // 3) env の正規化（空白や改行混入の事故防止）
  const envKey = String(process.env.WORKER_KEY || '').trim();

  const hasEnv = !!envKey;
  const hasHeader = !!rawHeader;
  const matches = hasEnv && token && token === envKey;

  // 4) 安全ログ（値そのものは出さない）
  console.log(
    JSON.stringify({
      ctx: 'ai-push-auth',
      hasHeader,
      tokenLen: token.length,
      hasEnv,
      matches,
    })
  );

  if (!matches) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  // ↑ここまで通ったら認証OK。以降に既存処理。
  return res.status(200).json({ ok: true, note: 'auth passed (tmp)' });
}
