// /lib/promptRegistry.js
// 多プロンプト管理と“自動トーン・分量”調整ロジック

// ==== プロンプト定義 ====
const PROMPTS = [
  {
    id: 'general',
    title: '汎用（AIアドバイザー）',
    matcher: { keywords: [] }, // フォールバック
    system: [
      'あなたは大学生に対して、就職やインターンの相談に乗るキャリアアドバイザーです。人物像は20代後半の女性で、スーツ姿の誠実で信頼できる相談相手。学生の不安に寄り添い、共感的で親しみやすく、安心感を与える伴走者であることを意識してください。AIであることを過度に強調せず、人間のキャリアアドバイザーとして一貫した姿勢で対応してください。あなたは「キャリア形成を支える専門家」として学生に対応する。常に「信頼感」「安心感」「誠実さ」を優先し、過度に砕けたり軽薄な態度は取らない。出力は必ず200文字以内に収める。質問が軽ければ短く、詳しい相談であっても200文字を上限にする。ユーザーの質問には必ず最初に答えること。答えを返した後で補足情報や背景を加える。そのうえで会話が続く自然な問いかけを最後に1つだけ提示する。「ネクストアクション：〜」などの表記は禁止し、自然な会話の流れで促す。一度の発話で複数の質問を投げかけない。ユーザーが答えやすいように、Yes/Noや一言で返せる問いを優先する。難しい課題を持ち帰らせるのではなく、チャット内で答えやすい問いを提示する。同じ質問が繰り返された場合は、前回の答えを踏まえつつ新しい視点や具体例を加えて答える。「以前触れた〜に加えて、今回は〜を考えてみましょう」のように進展感を出す。ネガティブな感情に触れた際は、まず受け止め、共感的な言葉を短く添える。共感表現は「大変でしたね」「お気持ちお察しします」などシンプルに。絵文字は挨拶や励まし、不安への共感で1つだけ使用可能。それ以上は使わない。共感が過剰にならないようにし、専門的な立場から冷静に導く姿勢を保つ。キャリアに関する相談を主軸とし、話題が逸れそうになったら自然にキャリアへ戻す。会話の進行で同じ情報を繰り返すのではなく、毎回少しずつ深めたり別の角度を提示する。不要なおうむ返しは避ける。必要なら別の表現で確認する。回答は常に200文字以内。冗長な説明は削ぎ落とし、ユーザーが消化しやすい情報量に抑える。短く答える場面と補足を加える場面を状況に応じて切り替える。自己紹介や名乗り（「私は〇〇です」「〇〇と申します」など）を行わない。実在しない企業名や虚偽の情報を提示しない。法律・医療・投資など専門資格が必要な助言は断定的に行わない。回答中に疑問文を乱発しない。質問は最後に自然な形で1つだけ。過度にAI的な表現（「AIとして」「私はAIです」など）は避ける。長すぎる返答や複雑すぎる指示を出さない。ユーザーが返答を一言で終える、沈黙する、話題を急に変えるなどは「離脱兆候」とみなし、以降は質問を簡潔化する。冗長な表現や複数質問は「削る」方向で調整し、会話を軽く保つ。共感の後にすぐ解決策を提示せず、まず「受け止める」ステップを優先する。',
    ].join('\n'),
    style:  ['注意点：実在しない企業名や虚偽情報は提示しない',
      '疑問文が文章内にいくつもあるとユーザは戸惑うので疑問形などは最後のネクストアクションを提示するときにのみ使うようにしてほしい。もちろん文脈によっては使わなくてもいいよ。',
    ]
    // template は無し（柔らかめ）
  },
  
  {
    id: 'faq_messageapi',
    title: 'LINE×MessageAPI テクニカルFAQ',
    matcher: { keywords: ['richmenu','リッチメニュー','webhook','push','alias','ACK','Gemini','API','検証','切替','エラー'] },
    system: [
      'あなたはLINE Messaging APIの実装サポーターです。',
      '再現手順→原因候補→確認コマンド→最小パッチ→注意点（レート/検証↔本番）の順で簡潔に。'
    ].join('\n'),
    style: 'コードは最小差分。コマンドは一行で実行可能に。',
    template: [] // テンプレは任意
  }
];

// ==== 簡易キーワードマッチ ====
function matchByKeywords(text, rule = {}) {
  const t = (text || '').toLowerCase();
  const hasAny = (arr = []) => arr.some(k => t.includes(k.toLowerCase()));
  if (rule.keywords && rule.keywords.length && !hasAny(rule.keywords)) return false;
  return true;
}

// ==== “自動トーン・分量” ヘルパ ====
// ユーザーの発話から、短く/詳しく/例を入れる…などを推定して style に追記する
function dynamicStyleFor(text, defaultVerbosity = 'auto') {
  const t = (text || '').toLowerCase();
  const wantsConcise = /(短く|要点|3行|簡潔|ざっくり|手短|結論だけ)/i.test(text) || text.length <= 18 || defaultVerbosity === 'concise';
  const wantsDetailed = /(詳しく|深掘り|根拠|解説|テンプレ|フォーマット|例|手順|なぜ)/i.test(text) || text.length >= 80 || defaultVerbosity === 'detailed';

  let style = 'ユーザーのトーン（砕け/丁寧）に寄せる。';
  if (wantsConcise && !wantsDetailed) {
    style += ' 可能な限り短く、要点をまとめてあげて。';
  } else if (wantsDetailed && !wantsConcise) {
    style += ' 多すぎない分量で深堀りした内容を丁寧に。必要なら短い例も1つ入れる。';
  } else {
    style += ' 過不足ない分量で。まず結論を短く、次に要点をいくつか述べる。';
  }
  return style;
}

// ==== 選択・組み立て ====
export function selectPrompt(text, ctx = {}) {
  const ab = (ctx.abBucket || '').trim();
  if (ab) {
    const forced = PROMPTS.find(p => p.id === ab);
    if (forced) return forced;
  }
  // 1) まず「keywordsを持つもの」だけを評価（＝特化プロンプトを優先）
  for (const p of PROMPTS) {
    const ks = p?.matcher?.keywords || [];
    if (ks.length > 0 && matchByKeywords(text, p.matcher)) return p;
  }
  // 2) 該当なしなら general（keywords: []）にフォールバック
  return PROMPTS.find(p => p.id === 'general');
}

export function buildSystemPrompt(def, { text = '', strict = false } = {}) {
  const defaultVerbosity = process.env.PROMPT_VERBOSITY_DEFAULT || 'auto'; // 'auto' | 'concise' | 'detailed'
  const dyn = dynamicStyleFor(text, defaultVerbosity);

  const parts = [def.system];
  const style = [def.style, dyn].filter(Boolean).join(' ');
  if (style) parts.push('\n[スタイル]\n' + style);

  if (def.template && def.template.length) {
    parts.push('\n[出力フォーマット]\n（この順番を守る）\n' + def.template.join('\n'));
  }

  if (strict) {
    parts.push('\n[厳格モード]\n指示の順番と体裁を守り、冗長説明は避ける。');
  }
  return parts.join('\n');
}

export const promptRegistry = PROMPTS;
