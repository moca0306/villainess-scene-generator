/**
 * 画像生成サービス — Gemini Image API (Nano Banana 2) のみ
 */

import { GoogleGenAI } from '@google/genai';

const MODEL_ID = 'gemini-3.1-flash-image-preview';

/**
 * 画像を1枚生成して base64 data URI を返す
 */
export const generate = async (
  prompt: string,
  referenceImages?: string[],  // base64 data URI[]
): Promise<string | null> => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const parts: any[] = [];

  // リファレンス画像（キャラシート等）を先に追加
  if (referenceImages && referenceImages.length > 0) {
    for (const ref of referenceImages.slice(0, 4)) {
      const [meta, data] = ref.split(',');
      const mimeType = meta.match(/:(.*?);/)?.[1] || 'image/png';
      parts.push({ inlineData: { data, mimeType } });
    }
    parts.push({
      text: `[${referenceImages.length} REFERENCE IMAGE(S) ABOVE]
CRITICAL: You MUST match the EXACT art style, line quality, coloring technique, and character design of these reference images.
The output image MUST look like it belongs to the SAME anime series as the reference images.
DO NOT change the art style. DO NOT switch to realistic, 3D, Disney, Pixar, or any other style.
The reference images define the ONLY acceptable art style for this generation.\n\n`,
    });
  }

  parts.push({ text: prompt });

  const res = await ai.models.generateContent({
    model: MODEL_ID,
    contents: { parts },
    config: { responseModalities: ['TEXT', 'IMAGE'] },
  });

  for (const part of res.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }
  return null;
};
