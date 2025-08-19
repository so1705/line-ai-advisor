// /lib/line.js
const LINE_BASE = "https://api.line.me/v2/bot";

function head() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
  };
}

export async function pushMessage(to, messages) {
  const res = await fetch(`${LINE_BASE}/message/push`, {
    method: "POST",
    headers: head(),
    body: JSON.stringify({ to, messages: [].concat(messages) }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`LINE push ${res.status}: ${t}`);
  }
}
