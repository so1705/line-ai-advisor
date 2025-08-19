// app/api/ai-push/route.js
export const runtime = 'edge'; // Edge の場合

export async function POST(req) {
  const auth =
    req.headers.get('authorization') ||
    req.headers.get('x-worker-key') ||
    '';

  const token = String(auth).replace(/^Bearer\s+/i, '').trim();
  const envKey = String(process.env.WORKER_KEY || '').trim();

  const hasEnv = !!envKey;
  const hasHeader = !!auth;
  const matches = hasEnv && token && token === envKey;

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
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 認証OK
  return new Response(JSON.stringify({ ok: true, note: 'auth passed (tmp)' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
