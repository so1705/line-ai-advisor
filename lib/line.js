// /lib/line.js
const BASE = "https://api.line.me/v2/bot";
const HEAD = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
});

export async function replyMessage(replyToken, messages) {
  if (!replyToken) return;
  const res = await fetch(`${BASE}/message/reply`, {
    method: "POST",
    headers: HEAD(),
    body: JSON.stringify({ replyToken, messages: [].concat(messages) }),
  });
  if (!res.ok) throw new Error(`LINE reply ${res.status}: ${await res.text()}`);
}

export async function pushMessage(to, messages) {
  if (!to) return;
  const res = await fetch(`${BASE}/message/push`, {
    method: "POST",
    headers: HEAD(),
    body: JSON.stringify({ to, messages: [].concat(messages) }),
  });
  if (!res.ok) throw new Error(`LINE push ${res.status}: ${await res.text()}`);
}

export const MSG = {
  ACK: [{ type: "text", text: "受け付けました。少々お待ちください。" }],
  SIGNATURE_NG: [{ type: "text", text: "署名検証に失敗しました。（ログに記録済み）" }],
  TOGGLE_ON: [{ type: "text", text: "AI応答：ON にしました。" }],
  TOGGLE_OFF: [{ type: "text", text: "AI応答：OFF にしました。" }],
};
