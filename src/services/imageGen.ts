/**
 * 画像生成サービス — Gemini Image API (Nano Banana) のみ
 */

import { GoogleGenAI } from '@google/genai';
import { ImageModel, Character } from '../types';

const MODELS: Record<ImageModel, string> = {
  flash: 'gemini-3.1-flash-image-preview',  // Nano Banana 2
  pro: 'gemini-3-pro-image-preview',         // Nano Banana Pro
};

let currentModel: ImageModel = 'flash';

export const setModel = (m: ImageModel) => { currentModel = m; };
export const getModel = () => currentModel;
export const getModelLabel = () =>
  currentModel === 'flash' ? 'Nano Banana 2' : 'Nano Banana Pro';

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
      text: `[${referenceImages.length} REFERENCE IMAGE(S) ABOVE — match these character designs and art style exactly]\n\n`,
    });
  }

  parts.push({ text: prompt });

  const res = await ai.models.generateContent({
    model: MODELS[currentModel],
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
