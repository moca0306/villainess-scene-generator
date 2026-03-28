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
// 3.5. カラーパレット自動選択（感情→色の連動）
// ================================================================

type ColorMood = 'warm_golden' | 'cold_blue' | 'dramatic_red' | 'soft_pink' | 'dark_ominous' | 'neutral_elegant' | 'dawn_hope' | 'sunset_melancholy';

const COLOR_PROMPTS: Record<ColorMood, string> = {
  warm_golden:
    'Color palette: WARM GOLDEN tones. Candlelight amber, honey gold highlights, soft orange glow. Feels safe, happy, luxurious.',
  cold_blue:
    'Color palette: COLD BLUE tones. Pale moonlight, icy blue shadows, desaturated colors. Feels lonely, tense, threatening.',
  dramatic_red:
    'Color palette: DRAMATIC RED-PURPLE tones. Deep crimson accents, rich purple shadows, high contrast. Feels powerful, intense, climactic.',
  soft_pink:
    'Color palette: SOFT PINK-ROSE tones. Blush pink highlights, gentle lavender, warm white. Feels romantic, tender, gentle.',
  dark_ominous:
    'Color palette: DARK OMINOUS tones. Deep shadows, muted greens and grays, minimal light. Feels dangerous, secretive, oppressive.',
  neutral_elegant:
    'Color palette: NEUTRAL ELEGANT tones. Cream whites, soft grays, subtle gold accents. Feels refined, calm, sophisticated.',
  dawn_hope:
    'Color palette: DAWN/SUNRISE tones. Soft orange-pink sky bleeding into light blue, gentle rays. Feels hopeful, fresh, new beginning.',
  sunset_melancholy:
    'Color palette: SUNSET MELANCHOLY tones. Deep orange fading to purple, long warm shadows. Feels bittersweet, reflective, transitional.',
};

const detectColorMood = (situation: string): ColorMood => {
  const s = situation;

  const rules: [RegExp, ColorMood][] = [
    // 怒り・断罪・覚醒・逆転 → 赤紫の劇的な色
    [/怒り|激怒|断罪|糾弾|覚醒|逆転|ざまぁ|見返|力を|爆発|炎/, 'dramatic_red'],
    // 恐怖・不安・陰謀・追い詰め → 暗い不穏な色
    [/恐怖|不安|陰謀|企み|追い詰|闇|毒|罠|裏切|策略|密か|覗/, 'dark_ominous'],
    // 悲しみ・孤立・絶望 → 冷たい青
    [/涙|泣|悲し|絶望|孤立|孤独|冷たい|見捨て|崩れ落ち|追放/, 'cold_blue'],
    // 恋愛・照れ・好意 → 柔らかいピンク
    [/ロマン|愛|好き|頬を赤|照れ|キス|手を繋|ドキ|見つめ合|告白/, 'soft_pink'],
    // 希望・決意・再出発 → 夜明けの色
    [/決意|希望|立ち上が|新しい|始ま|誓|目覚め|光が|朝/, 'dawn_hope'],
    // 別れ・回想・感慨 → 夕暮れの色
    [/別れ|去って|背を向|回想|思い出|最後|終わり|さよなら/, 'sunset_melancholy'],
    // 幸せ・華やか・舞踏会 → 暖色ゴールド
    [/幸せ|楽しそう|華やか|舞踏会|パーティ|笑顔|微笑|宴|歓声|紅茶|穏やか/, 'warm_golden'],
  ];

  for (const [re, mood] of rules) {
    if (re.test(s)) return mood;
  }

  return 'neutral_elegant';
};

// ================================================================
// 3.7. 状況説明からの具体的フレーミング指示抽出
// ================================================================
// 状況説明に書かれた具体的な画角指示（「口元アップ」「背中越し」等）を
// 自動構図選択より優先して反映する。プロの構図テクニックは維持しつつ、
// シナリオライターの演出意図を尊重する。

type FramingCue = {
  match: RegExp;
  directive: string;
};

const FRAMING_CUES: FramingCue[] = [
  // 部位アップ系
  { match: /口元[のが]?アップ|口元をアップ/, directive: 'FRAMING OVERRIDE: Frame a CLOSE-UP of the CHARACTER\'S MOUTH/LIPS filling the center of the frame. Show from nose to chin. Eyes may be partially visible at top edge but the MOUTH is the focal point.' },
  { match: /目[のが]?アップ|瞳[のが]?アップ|目を[大]?きく/, directive: 'FRAMING OVERRIDE: Frame a CLOSE-UP of the CHARACTER\'S EYES filling the center of the frame. Show from forehead to nose bridge. The EYES/PUPILS are the focal point.' },
  { match: /手[のが]?アップ|手元[のが]?アップ|握り[しめ締]/, directive: 'FRAMING OVERRIDE: Frame a CLOSE-UP of the CHARACTER\'S HANDS. Hands should fill the majority of the frame.' },
  { match: /涙[のが]?アップ|一粒の涙|涙が[一]?筋/, directive: 'FRAMING OVERRIDE: Frame an EXTREME CLOSE-UP showing a TEAR rolling down the cheek. The tear drop is the focal point.' },
  { match: /横顔[のが]?アップ|横顔/, directive: 'FRAMING OVERRIDE: Frame the character\'s SIDE PROFILE (横顔). Camera is perpendicular to the face, showing one eye, nose bridge, and jawline.' },
  { match: /後ろ姿|背中[のが]?アップ|背を向け/, directive: 'FRAMING OVERRIDE: Show the character FROM BEHIND. Camera faces the character\'s back. Face is NOT visible or only slightly turned.' },
  // 特殊フレーミング
  { match: /タイトルロゴ/, directive: 'FRAMING OVERRIDE: Leave clear NEGATIVE SPACE (approximately 30% of frame) for title logo placement. Compose so the main subject does not occupy the area where text would go.' },
  { match: /[二2]人[の]?(?:間|距離|関係)/, directive: 'FRAMING OVERRIDE: Frame BOTH characters with deliberate SPACE or DISTANCE between them to emphasize their relationship dynamic.' },
  { match: /見上げ[るて]|上を向/, directive: 'FRAMING OVERRIDE: Character is LOOKING UPWARD. Camera captures the upward gaze, possibly from slightly below.' },
  { match: /見下ろ[すし]/, directive: 'FRAMING OVERRIDE: Character is LOOKING DOWN at something/someone. Show the downward gaze with appropriate camera angle.' },
];

const extractFramingOverrides = (situation: string): string[] => {
  const overrides: string[] = [];
  for (const cue of FRAMING_CUES) {
    if (cue.match.test(situation)) {
      overrides.push(cue.directive);
    }
  }
  return overrides;
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
  medium: 'Medium shot CROPPED from waist up. The character fills at least 50% of the frame height. Upper body, face, and hand gestures clearly visible.',
  closeup: 'CLOSE-UP shot CROPPED from shoulders/neck up. The character\'s FACE fills at least 60-70% of the frame. Focus on facial expression, eyes, and emotion. Background is BLURRED and minimal. Do NOT show full body.',
  extreme_closeup: 'EXTREME close-up filling 80-90% of the frame with a single feature (eyes, lips, hands, tears). Almost NO background visible. Maximum EMOTIONAL IMPACT. This is the tightest possible crop.',
  object: 'Object/item focus filling most of the frame. Shallow depth of field. Detailed rendering. Background heavily blurred.',
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

const ART_STYLE = `High-quality cinematic JAPANESE ANIME style (2D hand-drawn aesthetic). Rich detailed backgrounds with atmospheric lighting and color storytelling. Dramatic color grading: warm golden highlights, cool blue shadows. Professional digital painting with clean linework. Fantasy European aristocratic setting. Expressive anime eyes.

STYLE LOCK — NEVER deviate from the reference images' art style:
- MUST be 2D Japanese anime style throughout
- NEVER realistic, photorealistic, 3D render, CGI, or live-action
- NEVER Disney, Pixar, Dreamworks, or Western cartoon style
- NEVER chibi, super-deformed, or simplified style
- Maintain CONSISTENT character proportions, face shape, and eye style across all frames
- If reference images are provided, treat their art style as the ABSOLUTE authority`;

export const buildPrompt = (
  situation: string,
  shotType: ShotType,
  composition: Composition,
  characterNames: string[],
  characters: Character[],
): string => {
  // キャラの外見情報を構築（画像参照 + テキスト外見描写の二重指定）
  const getChar = (name: string) => characters.find(ch => ch.name === name);
  const charDescriptions = characterNames
    .map(name => {
      const c = getChar(name);
      if (c?.imageUrl) {
        const base = `${name} (reference image attached — match design EXACTLY)`;
        // 外見テキストがあれば追加（髪色等を明示的に指定）
        return c.appearance ? `${base}\n  Visual details: ${c.appearance}` : base;
      }
      // キャラシートなし（モブ等）: スタイル参照がある旨を明記
      const anySheetExists = characters.some(ch => ch.imageUrl);
      return anySheetExists
        ? `${name} (NO character sheet — design this character to match the ART STYLE of the reference images, but as a DIFFERENT character)`
        : name;
    })
    .join('\n');

  const colorMood = detectColorMood(situation);

  // アップ系ショットの場合、背景レイヤーのルールを上書き
  const isCloseShot = shotType === 'closeup' || shotType === 'extreme_closeup' || shotType === 'object';
  const frameOverride = isCloseShot
    ? '\n- OVERRIDE: For this close-up shot, IGNORE the foreground/middle/background layer rule. The CHARACTER\'S FACE or DETAIL must DOMINATE the frame. Background should be BLURRED or MINIMAL.'
    : '';

  // 状況説明から具体的なフレーミング指示を抽出（シナリオの演出意図を最優先）
  const framingOverrides = extractFramingOverrides(situation);
  const framingSection = framingOverrides.length > 0
    ? `\n\n【CRITICAL — SCENARIO FRAMING DIRECTIVES (HIGHEST PRIORITY)】\nThe following directives come directly from the scenario and OVERRIDE generic shot type instructions when they conflict:\n${framingOverrides.join('\n')}`
    : '';

  return `Professional anime scene — single frame, NO text.

${MASTER_RULES}${frameOverride}

【COMPOSITION】
${COMPOSITION_PROMPTS[composition]}

【SHOT TYPE — THIS IS THE MOST IMPORTANT INSTRUCTION FOR FRAMING】
${SHOT_PROMPTS[shotType]}${framingSection}

【COLOR DIRECTION】
${COLOR_PROMPTS[colorMood]}

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

  // 全キャラ名リストを収集（状況列からのキャラ検出に使う）
  const allCharNames = Array.from(new Set(
    rows.map(r => r.character.replace(/[（(].+?[）)]/g, '').trim()).filter(Boolean)
  ));

  for (const row of rows) {
    // 状況がない行（セリフのみ）はスキップ — 画像不要
    if (!row.situation || row.situation.length < 3) continue;

    // キャラ名を正規化（character列 + 状況列から複数キャラを検出）
    const charBase = row.character.replace(/[（(].+?[）)]/g, '').trim();
    const charNamesSet = new Set<string>();
    if (charBase) charNamesSet.add(charBase);
    // 状況列に登場する他のキャラ名も検出
    for (const name of allCharNames) {
      if (name && row.situation.includes(name)) charNamesSet.add(name);
    }
    const charNames = Array.from(charNamesSet);

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
