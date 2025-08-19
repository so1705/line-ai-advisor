// /lib/ai.js
import { GoogleGenerativeAI } from "@google/generative-ai";

const POLICY = `出力ポリシー:
1) 120字前後のTL;DR
2) 箇条書きは最大3点
3) 最後に「次の一歩」を1つ`;
const SYS = `あなたはLINEの就活AIアドバイザーです。${POLICY}`;

function postProcess(t) {
  const lines = (t || "").split("\n");
  const out = [];
  let bullets = 0;
  for (const ln of lines) {
    if (/^\s*[-・*]/.test(ln)) { if (bullets < 3) out.push(ln), bullets++; continue; }
    out.push(ln);
  }
  return out.join("\n").slice(0, 2000);
}

export async function generateAdvice(userText) {
  const provider = (process.env.AI_PROVIDER || "gemini").toLowerCase();

  if (provider === "openai") {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY missing");
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        max_tokens: 500,
        messages: [{ role: "system", content: SYS }, { role: "user", content: userText }],
      }),
    });
    if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text()}`);
    const j = await r.json();
    return postProcess(j.choices?.[0]?.message?.content || "");
  }

  // Gemini（デフォルト）
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY missing");
  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  const r = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: `${SYS}\n\nユーザー入力:\n${userText}` }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 500 },
  });
  return postProcess(r.response?.text() ?? "");
}
