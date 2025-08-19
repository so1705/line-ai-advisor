// /lib/richmenu.js
// 現在そのユーザーにリンクされているリッチメニューIDを取得
export async function getLinkedRichMenuId(userId, accessToken) {
  if (!userId) return null;
  const url = `https://api.line.me/v2/bot/user/${encodeURIComponent(
    userId
  )}/richmenu`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 404) return null; // リンクなし
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error("getLinkedRichMenu error:", res.status, t);
    return null;
  }

  const json = await res.json();
  return json?.richMenuId ?? null;
}

// 「AIアドバイザーモードか？」を判定
export async function isAdvisorMode(userId, accessToken, advisorRichMenuId) {
  if (!advisorRichMenuId) return false; // 未設定なら常に通常モード
  const linked = await getLinkedRichMenuId(userId, accessToken);
  return linked === advisorRichMenuId;
}
