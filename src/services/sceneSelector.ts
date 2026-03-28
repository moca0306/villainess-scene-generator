/**
 * AIシーン選定 — Gemini 3.1 Pro で重要シーンを厳選
 */

import { GoogleGenAI } from '@google/genai';
import { ScriptRow } from '../types';

const SELECTOR_MODEL = 'gemini-3.1-pro';

// Gemini 3.1 Pro テキスト料金（USD / 1M tokens）
const PRICE_INPUT_PER_M = 1.25;
const PRICE_OUTPUT_PER_M = 10.0;

const SELECTION_PROMPT = `あなたはYouTube動画制作のプロディレクターであり、アニメ演出の専門家です。
以下のシナリオ（CSVの各行）から、YouTube動画として映像化する際に最も重要なシーンを厳選してください。

これはYouTube動画用の「静止画スライドショー」として使われます。
視聴者が飽きずに最後まで見続けられる映像的なリズムとテンポを最優先で考慮してください。

## 選定基準

### A. 物語面（何を見せるか）
1. **物語の転換点・クライマックス** — ストーリーが大きく動く瞬間
2. **キャラクターの初登場シーン** — 各キャラが初めて出てくる場面
3. **感情のピーク** — 怒り、涙、告白、衝撃など感情が最大になる瞬間
4. **起承転結のバランス** — 序盤・中盤・終盤を均等に配分

### B. 映像演出面（どう見せるか — アニメ私塾流レイアウト理論）
5. **場面転換時は必ず全景/引きカットを入れる** — 場所が変わったことを視聴者に伝えるため、シーン（scene列）が切り替わるタイミングでは状況描写が「外観」「全体」「会場」等を含む引きのカットを必ず1枚選ぶ
6. **ショットタイプのリズムを意識する** — アップ（顔・表情系）が3枚以上連続しないようにする。「引き→ミディアム→アップ→引き」のようなリズミカルな切り替えになるよう選定する
7. **視覚的バリエーションを確保する** — 同じキャラが同じような状況で映るシーンが連続する場合、1枚だけ残して他は除外する
8. **感情変化のビートには表情アップを入れる** — キャラの心情が大きく変わる瞬間は、表情が見えるアップ寄りのカットを選ぶ

## 除外すべきシーン
- セリフの繰り返しで状況描写がほぼ同じもの
- 前後のシーンと視覚的に変化がないもの（同じキャラ・同じ場所・同じ行動）
- ナレーションのみで映像的インパクトが薄いもの

## 出力形式
選定したシーンの行番号（no列の値）をJSON配列で返してください。
**必ずJSON配列のみを返し、他の文字は含めないでください。**

例: [1, 3, 5, 8, 12, 15]
`;

/** selectScenes の戻り値 */
export interface SelectionResult {
  selectedIds: number[];
  costUSD: number; // テキストAPI呼び出しにかかったコスト（USD）
}

/**
 * ルールベースのフォールバック選定（API不要）
 * シーン冒頭カット必須 + 状況描写の長さ・感情キーワードでスコアリング
 */
const fallbackSelect = (rows: ScriptRow[], targetCount: number): number[] => {
  // 状況列があるもの（画像化対象）だけ
  const visual = rows.filter(r => r.situation && r.situation.length >= 3);

  // 各行にスコアをつける
  const scored = visual.map((r, idx) => {
    let score = 0;
    const s = r.situation;

    // シーン冒頭カット（必須級）
    const isSceneStart = idx === 0 || visual[idx - 1]?.scene !== r.scene;
    if (isSceneStart) score += 100;

    // 感情キーワード
    if (/涙|泣|悲し|絶望|崩れ落ち/.test(s)) score += 30;
    if (/怒り|激怒|断罪|糾弾|指差/.test(s)) score += 30;
    if (/衝撃|驚愕|目を見開|まさか/.test(s)) score += 25;
    if (/覚醒|決意|逆転/.test(s)) score += 25;
    if (/キス|告白|好き|手を繋/.test(s)) score += 20;
    if (/シルエット|逆光|対比/.test(s)) score += 15;

    // 状況描写が具体的（長い）ほど映像的価値が高い
    score += Math.min(s.length / 3, 20);

    // キャラ名あり（キャラが映る）ほうが価値が高い
    if (r.character) score += 5;

    return { no: r.no, score, isSceneStart };
  });

  // シーン冒頭カットは必ず含める
  const mustInclude = scored.filter(s => s.isSceneStart).map(s => s.no);

  // 残り枠をスコア順で埋める
  const remaining = scored
    .filter(s => !s.isSceneStart)
    .sort((a, b) => b.score - a.score);

  const budget = Math.max(0, targetCount - mustInclude.length);
  const selected = new Set([
    ...mustInclude,
    ...remaining.slice(0, budget).map(s => s.no),
  ]);

  // 元の順序で返す
  return rows.filter(r => selected.has(r.no)).map(r => r.no);
};

/**
 * AIにシーンを厳選させる（失敗時はルールベースにフォールバック）
 */
export const selectScenes = async (
  rows: ScriptRow[],
  targetCount: number = 150,
): Promise<SelectionResult> => {
  // APIキーがない場合はフォールバック
  if (!process.env.GEMINI_API_KEY) {
    console.warn('GEMINI_API_KEY not set — using rule-based selection');
    return { selectedIds: fallbackSelect(rows, targetCount), costUSD: 0 };
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const csvText = rows
      .map(r => `no:${r.no} | scene:${r.scene} | character:${r.character} | dialogue:${r.dialogue} | situation:${r.situation}`)
      .join('\n');

    const prompt = `${SELECTION_PROMPT}

## 目標枚数: ${targetCount}枚（±10枚の誤差は許容）

## シナリオデータ（全${rows.length}行）
${csvText}`;

    const res = await ai.models.generateContent({
      model: SELECTOR_MODEL,
      contents: { parts: [{ text: prompt }] },
    });

    // トークン使用量からコスト計算
    const usage = res.usageMetadata;
    const inputTokens = usage?.promptTokenCount || 0;
    const outputTokens = usage?.candidatesTokenCount || 0;
    const costUSD =
      (inputTokens / 1_000_000) * PRICE_INPUT_PER_M +
      (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_M;

    const text = res.candidates?.[0]?.content?.parts?.[0]?.text || '[]';

    const jsonMatch = text.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) throw new Error('AI response did not contain JSON array');

    const selected: number[] = JSON.parse(jsonMatch[0]);
    return {
      selectedIds: selected.filter(n => rows.some(r => r.no === n)),
      costUSD,
    };
  } catch (err) {
    console.warn('AI selection failed, falling back to rule-based:', err);
    return { selectedIds: fallbackSelect(rows, targetCount), costUSD: 0 };
  }
};
