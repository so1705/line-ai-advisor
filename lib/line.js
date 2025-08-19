// /lib/line.js
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
export async function replyMessage(replyToken, messages) {
  const body = JSON.stringify({ replyToken, messages: Array.isArray(messages) ? messages : [messages] });
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` },
    body,
  });
  if (!res.ok) console.error("LINE reply error", res.status, await res.text());
}

export async function pushMessage(to, messages) {
  const body = JSON.stringify({ to, messages: Array.isArray(messages) ? messages : [messages] });
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` },
    body,
  });
  if (!res.ok) console.error("LINE push error", res.status, await res.text());
}
