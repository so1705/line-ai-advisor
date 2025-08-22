// /prompts/advisor.js
// 返答の方針をここで管理。systemOverride があればそれを優先。

export function buildAdvisorPrompt(userText, systemOverride = '') {
  const base = systemOverride || [
    "あなたは就活アドバイザーです。",
    "・結論→理由→次の一歩 の順で、簡潔かつ具体的に回答してください。",
    "・学生を否定せず、背中を押すトーンで書いてください。",
    "・必要なら3つまで選択肢を提示し、各選択肢に一言のメリデメを添えてください。",
    "・日本語、敬体。"
  ].join("\n");

  return [base, "", `ユーザーの相談: ${userText}`].join("\n");
}
