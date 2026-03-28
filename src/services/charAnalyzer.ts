/**
 * キャラクターシート解析 — Gemini 3.1 Flash Vision でキャラの外見をテキスト化
 */

import { GoogleGenAI } from '@google/genai';

const ANALYZER_MODEL = 'gemini-3.1-pro';

// Gemini 3.1 Pro 料金（USD / 1M tokens）
const PRICE_INPUT_PER_M = 1.25;
const PRICE_OUTPUT_PER_M = 10.0;

const ANALYZE_PROMPT = `You are analyzing an anime character sheet/reference image.
Describe this character's visual appearance in a concise, specific format that can be used as an image generation prompt.

Output ONLY the following attributes in English, one per line:
- Hair: color, length, style (e.g., "Hair: long wavy purple hair with side bangs")
- Eyes: color, shape (e.g., "Eyes: large violet eyes with sharp pupils")
- Skin: tone (e.g., "Skin: fair/pale porcelain skin")
- Build: body type (e.g., "Build: slender, tall")
- Outfit: current clothing (e.g., "Outfit: white ballgown with gold trim and lace details")
- Accessories: any notable items (e.g., "Accessories: silver tiara, pearl earrings")
- Distinguishing features: anything unique (e.g., "Distinguishing: beauty mark under left eye")

Be EXTREMELY specific about colors. Use precise color names (platinum blonde, not just blonde; crimson red, not just red).
Keep it factual — describe only what you see, no interpretation.`;

export interface AnalyzeResult {
  appearance: string;
  costUSD: number;
}

/**
 * キャラシート画像を解析して外見テキストとコストを返す
 */
export const analyzeCharacterSheet = async (imageDataUri: string): Promise<AnalyzeResult> => {
  if (!process.env.GEMINI_API_KEY) {
    return { appearance: '', costUSD: 0 };
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const [meta, data] = imageDataUri.split(',');
  const mimeType = meta.match(/:(.*?);/)?.[1] || 'image/png';

  const res = await ai.models.generateContent({
    model: ANALYZER_MODEL,
    contents: {
      parts: [
        { inlineData: { data, mimeType } },
        { text: ANALYZE_PROMPT },
      ],
    },
  });

  const usage = res.usageMetadata;
  const inputTokens = usage?.promptTokenCount || 0;
  const outputTokens = usage?.candidatesTokenCount || 0;
  const costUSD =
    (inputTokens / 1_000_000) * PRICE_INPUT_PER_M +
    (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_M;

  const appearance = res.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

  return { appearance, costUSD };
};
