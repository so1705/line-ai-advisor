// 最終切り分け用の一時パッチ（Node / API Routes 版）
// 認証の成否をログで可視化し、200/401で返すだけの最小ハンドラ
// ※デバッグが終わったら note と console.log は削除してください

export default async function handler(req, res) {
  try {
    // 1) ヘッダー取得（Authorization / x-worker-key の両対応）
    const raw =
      req.headers['authorization'] ??
      req.headers['Authorization'] ??
      req.headers['x-worker-key'] ??
      req.headers['X-Worker-Key'] ??
      '';

    // 2) 正規化（"Bearer " を外し、前後空白を除去）
    const token = String(raw).replace(/^Bearer\s+/i, '').trim();

    // 3) 環境変数（空白/改行混入の事故防止で trim）
    const envKey = String(process.env.WORKER_KEY || '').trim();

    const hasEnv = Boolean(envKey);
    const hasHeader = Boolean(raw);
    const matches = hasEnv && Boolean(token) && token === envKey;

    // 4) 安全ログ（値そのものは出さない）
    console.log(
      JSON.stringify({
        ctx: 'ai-push-auth',
        hasEnv,
        hasHeader,
        tokenLen: token.length,
        matches,
      })
    );

    // 5) 認証判定
    if (!matches) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }

    // 6) 認証OK（デバッグ用の仮レスポンス）
    return res
      .status(200)
      .json({ ok: true, note: 'auth passed (tmp)' });

    // TODO: 認証が通ることを確認後、上の仮レスを削除して本来の処理へ差し替え
  } catch (err) {
    console.error('ai-push fatal', err);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
}
