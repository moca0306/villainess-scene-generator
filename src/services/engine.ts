/**
 * コアエンジン — AIを使わず、CSVから画像生成プロンプトを構築する
 *
 * CSV「状況」列 → ショットタイプ自動判定 → 構図テクニック自動選択 → プロンプト構築
 */

import { ScriptRow, Panel, Character, ShotType, Composition } from '../types';

// ================================================================
// 1. CSVパーサー
// ================================================================

const parseCSVLine = (line: string): string[] => {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
};

export const parseCSV = (text: string): ScriptRow[] => {
  const lines = text.split('\n');
  const rows: ScriptRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const f = parseCSVLine(line);
    if (f.length < 5) continue;
    const no = parseInt(f[0], 10);
    if (isNaN(no)) continue;
    rows.push({
      no,
      scene: f[1] || '',
      character: f[2] || '',
      dialogue: f[3] || '',
      situation: f[4] || '',
      charCount: parseInt(f[5], 10) || 0,
    });
  }
  return rows;
};

export const extractCharacterNames = (rows: ScriptRow[]): string[] => {
  const names = new Set<string>();
  for (const r of rows) {
    if (!r.character) continue;
    const base = r.character.replace(/[（(].+?[）)]/g, '').trim();
    if (base && base !== 'ナレーション') names.add(base);
  }
  return Array.from(names);
};

// ================================================================
// 2. ショットタイプ自動判定
// ================================================================

const detectShotType = (situation: string, character: string): ShotType => {
  const s = situation.toLowerCase();

  // 状況なし or ト書き（場面転換系）
  if (!situation || situation.length < 5) return 'establishing';

  // キーワードマッチ
  if (/外観|全体|引き|会場|背景|場面転換|フェード|ロング/.test(s)) return 'establishing';
  if (/目の?アップ|瞳|涙|一粒|超アップ/.test(s)) return 'extreme_closeup';
  if (/アップ|顔|表情|横顔|口元|目が/.test(s)) return 'closeup';
  if (/全身|立ち姿|歩く|歩い|走|並んで|シルエット|後ろ姿/.test(s)) return 'long';
  if (/メモ帳|記録石|書類|料理|小道具|グラス|手紙|鍵/.test(s)) return 'object';

  // キャラがいればmedium、いなければestablishing
  return character ? 'medium' : 'establishing';
};

const SHOT_LABELS: Record<ShotType, string> = {
  establishing: '導入（全景）',
  long: '引き（全身）',
  medium: 'ミディアム',
  closeup: 'アップ',
  extreme_closeup: '超アップ',
  object: '物アップ',
};

// ================================================================
// 3. 構図テクニック自動選択（アニメ私塾PDFベース）
// ================================================================

const COMP_LABELS: Record<Composition, string> = {
  asymmetric_split: '非対称分割',
  triangle_stable: '三角形（安定）',
  triangle_inverted: '逆三角形（不安定）',
  diagonal_dynamic: '対角線',
  wide_angle_dramatic: '広角パース',
  telephoto_compressed: '望遠圧縮',
  low_angle_power: '煽り',
  high_angle_overview: '俯瞰',
  over_shoulder: 'オーバーショルダー',
  silhouette_dramatic: 'シルエット',
  foreground_frame: '前景フレーミング',
  extreme_closeup_emotion: '超クローズアップ',
};

const detectComposition = (situation: string, shotType: ShotType, prevComp?: Composition): Composition => {
  const s = situation;

  // 感情・状況キーワード → 構図マッピング
  const rules: [RegExp, Composition][] = [
    [/怒り|激怒|断罪|裁き|見下ろす|威圧|指差|糾弾/, 'low_angle_power'],
    [/恐怖|不安|緊迫|追い詰|崩れ落ち|絶望|歪む/, 'triangle_inverted'],
    [/涙|泣|悲し|一粒|目のアップ|瞳/, 'extreme_closeup_emotion'],
    [/衝撃|驚愕|目を見開|まさか|息を飲/, 'wide_angle_dramatic'],
    [/ロマン|愛|好き|頬を赤|照れ|キス|手を繋/, 'telephoto_compressed'],
    [/穏やか|幸せ|楽しそう|微笑|温かい|笑顔|紅茶/, 'triangle_stable'],
    [/走|追|急|翻|駆け|振り返/, 'diagonal_dynamic'],
    [/対峙|向かい合|会話|言い争|二人|睨/, 'over_shoulder'],
    [/孤立|一人|孤独|俯瞰|見下ろ|会場全体/, 'high_angle_overview'],
    [/覗|密か|影|柱の陰|扇子で/, 'foreground_frame'],
    [/シルエット|逆光|覚醒|決意|光/, 'silhouette_dramatic'],
  ];

  for (const [re, comp] of rules) {
    if (re.test(s)) {
      // 前のコマと同じ構図なら別のを選ぶ（バリエーション確保）
      if (comp === prevComp) continue;
      return comp;
    }
  }

  // ショットタイプベースのフォールバック
  const fallbacks: Record<ShotType, Composition> = {
    establishing: 'asymmetric_split',
    long: 'asymmetric_split',
    medium: 'over_shoulder',
    closeup: 'telephoto_compressed',
    extreme_closeup: 'extreme_closeup_emotion',
    object: 'foreground_frame',
  };

  const fb = fallbacks[shotType];
  return fb === prevComp ? 'asymmetric_split' : fb;
};

// ================================================================
// 4. プロンプトビルダー
// ================================================================

const COMPOSITION_PROMPTS: Record<Composition, string> = {
  asymmetric_split:
    'Asymmetric frame division. Divide the frame into UNEQUAL areas using horizon, architecture, or lighting. Subject placed off-center using rule of thirds.',
  triangle_stable:
    'Triangle composition. Arrange elements to form a stable triangle/pyramid shape. Conveys warmth, safety, peace.',
  triangle_inverted:
    'Inverted triangle composition. Narrow base creates INSTABILITY and TENSION. Scene feels like it could collapse.',
  diagonal_dynamic:
    'Strong diagonal lines cutting across the frame. Creates DYNAMIC ENERGY and MOVEMENT. Guides the eye powerfully.',
  wide_angle_dramatic:
    'Wide-angle perspective (24mm lens feel). STRONG perspective distortion. Radiating lines from vanishing point. Exaggerated depth.',
  telephoto_compressed:
    'Telephoto compression (200mm lens feel). COMPRESSED depth. Background feels close. Shallow DOF with beautiful bokeh. Intimate and lyrical.',
  low_angle_power:
    'LOW ANGLE looking UP at the subject. Subject TOWERS over viewer. Creates DOMINANCE and POWER. Ceiling/sky visible.',
  high_angle_overview:
    'HIGH ANGLE looking DOWN. Shows spatial relationships. Subject appears small and vulnerable in environment.',
  over_shoulder:
    'Over-the-shoulder shot. One character\'s shoulder/head in soft-focus foreground. Creates CONFRONTATION and dialogue tension.',
  silhouette_dramatic:
    'Dramatic SILHOUETTE against bright/colorful background. Backlit with rim lighting. Pose must be readable as pure silhouette.',
  foreground_frame:
    'Foreground elements (pillars, curtains, branches) FRAME the subject. Adds depth and cinematic layering. Foreground in soft focus.',
  extreme_closeup_emotion:
    'EXTREME close-up filling frame with face or single feature (eyes, lips, tears). Maximum EMOTIONAL IMPACT.',
};

const SHOT_PROMPTS: Record<ShotType, string> = {
  establishing: 'Wide establishing shot showing the full location/exterior. Architecture and atmosphere emphasized. Characters small or absent.',
  long: 'Long/full shot showing characters head-to-toe in environment. Body language and spatial relationships visible.',
  medium: 'Medium shot from waist up. Upper body expression and hand gestures visible.',
  closeup: 'Close-up on face and upper chest. Facial expression and emotion emphasized.',
  extreme_closeup: 'EXTREME close-up on specific detail (eyes, hands, tears). Maximum emotional impact.',
  object: 'Object/item focus. Shallow depth of field. Detailed rendering.',
};

const MASTER_RULES = `ABSOLUTE RULES:
- NO speech bubbles, NO text, NO captions of any kind
- NEVER center the character in the middle of the frame (FORBIDDEN "hinomaru" composition)
- ALWAYS use asymmetric, dynamic framing like professional anime (Your Name, Violet Evergarden)
- Every pose must be readable as a pure silhouette (exaggerated acting)
- Leave directional space in the direction characters face
- Always have foreground, middle-ground, and background layers
- Rich detailed backgrounds with atmospheric lighting
- 16:9 widescreen cinematic aspect ratio`;

const ART_STYLE = `High-quality cinematic anime style. Rich detailed backgrounds with atmospheric lighting and color storytelling. Dramatic color grading: warm golden highlights, cool blue shadows. Professional digital painting with clean linework. Fantasy European aristocratic setting. Expressive anime eyes.`;

export const buildPrompt = (
  situation: string,
  shotType: ShotType,
  composition: Composition,
  characterNames: string[],
  characters: Character[],
): string => {
  // キャラの外見情報を構築
  const charDescriptions = characterNames
    .map(name => {
      const c = characters.find(ch => ch.name === name);
      return c ? `${name} (reference image attached)` : name;
    })
    .join(', ');

  return `Professional anime scene — single frame, NO text.

${MASTER_RULES}

【COMPOSITION】
${COMPOSITION_PROMPTS[composition]}

【SHOT TYPE】
${SHOT_PROMPTS[shotType]}

【SCENE DESCRIPTION】
${situation}

【CHARACTERS IN SCENE】
${charDescriptions || 'No specific characters — focus on environment/mood'}

【ART STYLE】
${ART_STYLE}`.trim();
};

// ================================================================
// 5. メインパイプライン: CSV → Panel[]
// ================================================================

export const buildPanels = (rows: ScriptRow[], characters: Character[]): Panel[] => {
  const panels: Panel[] = [];
  let prevComp: Composition | undefined;

  for (const row of rows) {
    // 状況がない行（セリフのみ）はスキップ — 画像不要
    if (!row.situation || row.situation.length < 3) continue;

    // キャラ名を正規化
    const charBase = row.character.replace(/[（(].+?[）)]/g, '').trim();
    const charNames = charBase ? [charBase] : [];

    // 自動判定
    const shotType = detectShotType(row.situation, row.character);
    const composition = detectComposition(row.situation, shotType, prevComp);
    prevComp = composition;

    // プロンプト構築
    const prompt = buildPrompt(row.situation, shotType, composition, charNames, characters);

    panels.push({
      id: row.no,
      scene: row.scene,
      character: row.character,
      dialogue: row.dialogue,
      situation: row.situation,
      shotType,
      shotTypeLabel: SHOT_LABELS[shotType],
      composition,
      compositionLabel: COMP_LABELS[composition],
      prompt,
      status: 'ready',
    });
  }

  return panels;
};
