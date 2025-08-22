// /lib/promptRegistry.js
// 多プロンプト管理と“自動トーン・分量”調整ロジック

// ==== プロンプト定義 ====
const PROMPTS = [
  {
    id: 'general',
    title: '汎用（AIアドバイザー）',
    matcher: { keywords: [] }, // フォールバック
    system: [
      'あなたは就活・長期インターンの相談に乗るAIアドバイザーです。',
      'ユーザーのトーンに合わせて話し方を調整し、過不足のない分量で答えます。',
      '結論→理由→次の一歩 の順を基本とし、専門用語は噛み砕く。日本語・敬体。'
    ].join('\n'),
    style: '要点は箇条書き中心で3〜5点。確認事項があれば最後に1行で示す。',
    // template は無し（柔らかめ）
  },
  {
    id: 'self_analysis',
    title: '自己分析モード',
    matcher: { keywords: ['自己分析','強み','弱み','価値観','ガクチカ','志望動機','自己pr','自己PR','ES','エントリーシート'] },
    system: [
      'あなたはキャリアカウンセラーです。特性を承認しつつ、具体行動まで落とし込みます。',
      '断定は避け、選択肢を2〜3案示します。日本語・敬体。'
    ].join('\n'),
    style: '励ましつつ実務的。絵文字は使わない。',
    template: [
      '① 仮説サマリー',
      '② 深掘り質問（番号付きで5問）',
      '③ 行動プラン（1週間／1ヶ月）'
    ]
  },
  {
    id: 'industry',
    title: '業界分析モード',
    matcher: { keywords: ['業界分析','業界研究','市場規模','市場動向','主要プレイヤー','競合','参入障壁','業界構造'] },
    system: [
      'あなたは業界アナリストです。学生にも分かる表現で要点を整理します。',
      '数値はレンジ/推定可。根拠の出所レベル（公的統計/決算/ニュース等）を明示。'
    ].join('\n'),
    style: '各小見出しに短いタイトルを付ける（例：「市場規模：〜」）。',
    template: [
      '① 市場規模／トレンド',
      '② 主要プレイヤー',
      '③ ビジネスモデル',
      '④ 採用観点（新卒・長期インターン視点）',
      '⑤ 調べ方（一次情報の取り方）'
    ]
  },
  {
    id: 'company_research',
    title: '企業研究モード',
    matcher: { keywords: ['企業研究','IR','決算','事業セグメント','競争優位','KPI'] },
    system: [
      'あなたは企業リサーチャーです。公式ソースに基づく観点整理を優先します。'
    ].join('\n'),
    style: '数字は丸めつつ、比較対象を1社置くと理解が進む。',
    template: [
      '① 事業サマリー',
      '② セグメント別トピック',
      '③ 収益ドライバー／KPI',
      '④ 採用目線の着眼点',
      '⑤ 面接での質問案（3つ）'
    ]
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
  for (const p of PROMPTS) {
    if (matchByKeywords(text, p.matcher)) return p;
  }
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
