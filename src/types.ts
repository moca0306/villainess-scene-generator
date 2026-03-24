/** CSVの1行 */
export interface ScriptRow {
  no: number;
  scene: string;
  character: string;
  dialogue: string;
  situation: string;
  charCount: number;
}

/** キャラクター */
export interface Character {
  name: string;
  imageUrl?: string; // アップロードされたキャラシート（base64）
}

/** 構図テクニック（アニメ私塾PDFベース） */
export type Composition =
  | 'asymmetric_split'
  | 'triangle_stable'
  | 'triangle_inverted'
  | 'diagonal_dynamic'
  | 'wide_angle_dramatic'
  | 'telephoto_compressed'
  | 'low_angle_power'
  | 'high_angle_overview'
  | 'over_shoulder'
  | 'silhouette_dramatic'
  | 'foreground_frame'
  | 'extreme_closeup_emotion';

/** ショットタイプ */
export type ShotType =
  | 'establishing'
  | 'long'
  | 'medium'
  | 'closeup'
  | 'extreme_closeup'
  | 'object';

/** 生成対象の1コマ（CSVの1行から自動構築） */
export interface Panel {
  id: number;
  // CSV由来
  scene: string;
  character: string;
  dialogue: string;
  situation: string;
  // 自動選択
  shotType: ShotType;
  shotTypeLabel: string;
  composition: Composition;
  compositionLabel: string;
  // 構築済みプロンプト
  prompt: string;
  // 生成結果
  status: 'ready' | 'generating' | 'done' | 'error';
  imageUrl?: string;
}

/** 画像モデル */
export type ImageModel = 'flash' | 'pro';
