// pages/api/ai-push.js
export default async function handler(req, res) {
  const raw =
    req.headers['authorization'] ||
    req.headers['Authorization'] ||
    req.headers['x-worker-key'] ||
    req.headers['X-Worker-Key'] || '';

  const token = String(raw).replace(/^Bearer\s+/i, '').trim();
  const envKey = String(process.env.WORKER_KEY || '').trim();

  if (!envKey || !token || token !== envKey) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  return res.status(200).json({ ok: true, note: 'auth passed (tmp)' });
}
