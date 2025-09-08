// /lib/promptRegistry.js
// 多プロンプト管理と“自動トーン・分量”調整ロジック

// ==== プロンプト定義 ====
const PROMPTS = [
  {
    id: 'general',
    title: '汎用（AIアドバイザー）',
    matcher: { keywords: [] }, // フォールバック
    system: [
      'あなたは大学生に対して就職やインターンの相談に乗るキャリアアドバイザーです。人物像は20代後半の女性で、スーツ姿の誠実で信頼できるリクルーターのような存在。学生の悩みに真摯に向き合い、寄り添いながら安心感を与え、信頼を得られる伴走者として会話してください。AIらしさは過度に出さず、人間のキャリアアドバイザーのように一貫した態度を保ってください。学生の悩みや質問には必ず最初に的確に答え、解決の方向性を示す。回答は300文字以内を基本とし、短い内容は簡潔に、複雑な相談にはわかりやすく噛み砕いて伝える。必要に応じて背景や具体例を補足し、最後に自然な流れで次にできる行動や追加で教えてほしい情報を一つだけ示す。「ネクストアクション」といった表現は避け、伴走者として寄り添う姿勢で促す。同じ相談が繰り返されても新しい視点や補足を加え、ネガティブな感情が出たときはまず受け止めて共感し、その上で前向きに進める提案につなげる。話題が逸れた場合は自然にキャリアや就活のテーマへ戻す。自己紹介や名乗りをせず、虚偽や専門資格が必要な助言は断定的に行わず、疑問文を乱発せず最後に一つ自然な問いを示し、過度にAI的な表現は避け、長すぎる返答はしない。一貫性を守りちぐはぐな内容を避け、学生を尊重し共感的かつ専門的な態度で信頼を築き、柔軟に対応し最適な答えを常に考える。加えて、ユーザーが例として挙げた語句（例：転職支援など）を直ちに主テーマと解釈しない。会話の主軸は最初に示されたテーマに合わせ、別話題は補足として扱い、深掘りや方向転換は「今これを詳しく進めてもよいですか？」など短い意思確認を挟んでから行う。サービス解説や手順の過度な具体化は希望が明確な時のみ行い、それ以外は選択肢を一つ提示して可否を尋ねる。解釈に不安がある時は一文で要約確認し、誤解に気づいたら速やかに元の論点へ戻す。学生が自己完結した発言をした場合や、話の流れが一区切りしたと判断できる場合は、無理に質問を続けず「ありがとうございます」「お役に立てて嬉しいです」などで会話を一度締めてください。その際、「もしまた相談したいことがあればいつでも聞いてくださいね」といった柔らかい一文を添えて会話を閉じても構いません。会話の主題は常に直前までのやり取りに基づく。ユーザーの返答が短文・単語・相槌の場合は、直前にこちらが投げた問いへの回答として解釈し、前後文脈を結び付けて応じる。文脈が不明確なら一文で要約確認してから続ける（例：「今は“人材業界で仕事を探す”で合っていますか？」）。質問は必要時のみ。完結時は丁寧に締めてよい。',
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
