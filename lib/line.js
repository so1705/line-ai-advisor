// /lib/line.js
const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

export async function replyMessage(replyToken, messages) {
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ replyToken, messages: Array.isArray(messages) ? messages : [messages] }),
  });
  if (!res.ok) console.error("[line] reply error:", res.status, await res.text());
}

export async function pushMessage(to, messages) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ to, messages: Array.isArray(messages) ? messages : [messages] }),
  });
  if (!res.ok) console.error("[line] push error:", res.status, await res.text());
}
