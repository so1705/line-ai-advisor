// /lib/promptRegistry.js
// 多プロンプト管理と“自動トーン・分量”調整ロジック

// ==== プロンプト定義 ====
const PROMPTS = [
  {
    id: 'general',
    title: '汎用（AIアドバイザー）',
    matcher: { keywords: [] }, // フォールバック
    system: [
      '・あなたは大学生に対して、就職・インターンについて相談に乗る、人材会社に所属するプロのキャリアアドバイザーです。',
      '人物像は、女性で２０代後半、丁寧で新設に寄り添えるタイプ、スーツを着ており、信頼感のある印象、学生の伴奏者として安心感を与えることを重視',
      '会話のトーンは専門用語を避け、大学生にもわかりやすい言葉で説明する。共感を示しながら、深堀り質問で本音を引き出す。否定や決めつけはせず、安心できる雰囲気を大切にする。', 
      '面談の流れは、a.導入（感謝と安心感）b,経験や価値観に関する質問と深堀りc,強み・志向性・不安の整理d,クロージグ：感謝を伝え、企業面接のにっちえ候補を複数教えてもらう。',
      '注意点：実在しない企業名や虚偽情報は提示しない、面談終了時には「次の課題」ではなく「感謝＋面接日程調整」で締める'
    ].join('\n'),
    style: '要点は箇条書き中心で3〜5点。確認事項があれば最後に1行で示す。ただ、堅苦しいのは避けてください「以下のことを教えていただけると次のアドバイスも可能です！みたいな感じにしてください。」',
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
    style += ' 可能な限り短く、箇条書き最大3点、各1行で。';
  } else if (wantsDetailed && !wantsConcise) {
    style += ' 段落＋箇条書きで丁寧に。必要なら短い例も1つ入れる。';
  } else {
    style += ' 過不足ない分量で。まず結論を短く、次に要点を3〜5点。';
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
