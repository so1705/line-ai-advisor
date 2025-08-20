// lib/richmenu.js
// リッチメニュー判定まわり（デバッグログ付き）

/**
 * 現在ユーザーにリンクされている richMenuId を取得
 */
export async function getLinkedRichMenuId(userId, token) {
  const url = `https://api.line.me/v2/bot/user/${userId}/richmenu`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    console.warn("getLinkedRichMenuId GET failed", {
      status: res.status,
      body,
      userId,
    });
    return null;
  }
  const json = await res.json().catch(() => ({}));
  return json?.richMenuId ?? null;
}

/**
 * AI アドバイザーモードかどうか（= advisorId が現在リンク中の richMenuId と一致）
 * 失敗時は false を返す
 */
export async function isAdvisorMode(userId, token, advisorId) {
  try {
    const richMenuId = await getLinkedRichMenuId(userId, token);
    const on = !!richMenuId && richMenuId === advisorId;
    console.log("isAdvisorMode compare", { richMenuId, advisorId, on, userId });
    return on;
  } catch (e) {
    console.error("isAdvisorMode error", e);
    return false;
  }
}

/** （参考：個別リンク/解除。必要時だけ呼んでOK） */
export async function linkRichMenu(userId, token, richMenuId) {
  const url = `https://api.line.me/v2/bot/user/${userId}/richmenu/${richMenuId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    console.warn("linkRichMenu failed", { status: res.status, body, userId, richMenuId });
  }
  return res.ok;
}

export async function unlinkRichMenu(userId, token) {
  const url = `https://api.line.me/v2/bot/user/${userId}/richmenu`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    console.warn("unlinkRichMenu failed", { status: res.status, body, userId });
  }
  return res.ok;
}
