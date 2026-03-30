import React, { useState, useRef, useCallback } from 'react';
import JSZip from 'jszip';
import { Character, Panel, ScriptRow } from './types';
import { parseCSV, extractCharacterNames, buildPanels } from './services/engine';
import { generate } from './services/imageGen';
import { selectScenes } from './services/sceneSelector';
import CharacterSetup from './components/CharacterSetup';
import PanelList from './components/PanelList';
import ImagePreview from './components/ImagePreview';

// 1枚あたりのコスト（USD、Nano Banana 2 = gemini-3.1-flash-image-preview）
const COST_PER_IMAGE = 0.067;
const USD_TO_JPY = 150; // おおよそのレート

const App: React.FC = () => {
  // ── 状態 ──
  const [characters, setCharacters] = useState<Character[]>([]);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [csvLoaded, setCsvLoaded] = useState(false);
  const [csvName, setCsvName] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [allRows, setAllRows] = useState<ScriptRow[]>([]);
  const [isSelecting, setIsSelecting] = useState(false);
  const [targetCount, setTargetCount] = useState(150);
  const [textApiCostUSD, setTextApiCostUSD] = useState(0); // AI選定のテキストAPIコスト累計
  const [imgGenCount, setImgGenCount] = useState(0); // 画像生成の累計回数（再生成含む）
  const stopRef = useRef(false);
  const pauseRef = useRef(false);

  // ── CSV読み込み → 自動AI選定 ──
  const handleCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = async () => {
      const text = reader.result as string;
      const rows = parseCSV(text);
      const names = extractCharacterNames(rows);
      setCharacters(names.map(n => ({ name: n })));
      setAllRows(rows);
      setCsvLoaded(true);
      setCsvName(file.name);

      // 自動でAI選定を実行
      setIsSelecting(true);
      setPanels([]); // 選定完了まで空にしておく
      try {
        const result = await selectScenes(rows, targetCount);
        const filteredRows = rows.filter(r => result.selectedIds.includes(r.no));
        setPanels(buildPanels(filteredRows, []));
        setTextApiCostUSD(prev => prev + result.costUSD);
      } catch (err) {
        console.error('AI selection failed:', err);
        // 失敗時は全件表示
        setPanels(buildPanels(rows, []));
      }
      setIsSelecting(false);
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  };

  // ── キャラシート変更時にパネルを再構築 ──
  const handleCharUpdate = (updated: Character[]) => {
    setCharacters(updated);
    // パネルのプロンプトを再生成（キャラ画像参照を更新）
    setPanels(prev => {
      const rebuilt = buildPanels(
        prev.map(p => ({
          no: p.id,
          scene: p.scene,
          character: p.character,
          dialogue: p.dialogue,
          situation: p.situation,
          charCount: 0,
        })),
        updated,
      );
      // 既に生成済みの画像は保持
      return rebuilt.map(rp => {
        const old = prev.find(op => op.id === rp.id);
        return old?.imageUrl ? { ...rp, imageUrl: old.imageUrl, status: old.status } : rp;
      });
    });
  };

  // ── AI厳選 ──
  const handleAISelect = async () => {
    if (allRows.length === 0) return;
    setIsSelecting(true);
    try {
      const result = await selectScenes(allRows, targetCount);
      const filteredRows = allRows.filter(r => result.selectedIds.includes(r.no));
      setPanels(buildPanels(filteredRows, characters));
      setTextApiCostUSD(prev => prev + result.costUSD);
    } catch (err) {
      console.error('AI selection failed:', err);
      alert('AI選定に失敗しました。全シーンのまま続行します。');
    }
    setIsSelecting(false);
  };

  // ── リファレンス画像収集（状況列に登場する全キャラのシートを収集） ──
  const collectRefs = (panel: Panel): string[] => {
    const refs: string[] = [];
    const charBase = panel.character.replace(/[（(].+?[）)]/g, '').trim();

    // character列のキャラ + 状況列に名前が出てくるキャラ全員のシートを収集
    const mentionedNames = new Set<string>();
    if (charBase) mentionedNames.add(charBase);
    for (const c of characters) {
      if (c.name && panel.situation.includes(c.name)) mentionedNames.add(c.name);
    }

    for (const name of mentionedNames) {
      const sheet = characters.find(c => c.imageUrl && c.name === name);
      if (sheet) refs.push(sheet.imageUrl!);
    }

    // 誰のシートも見つからなければスタイル参照として1枚渡す
    if (refs.length === 0) {
      const styleRef = characters.find(c => c.imageUrl);
      if (styleRef) refs.push(styleRef.imageUrl!);
    }

    return refs;
  };

  // ── 一時停止中にresolveを待つユーティリティ ──
  const waitWhilePaused = () => new Promise<void>(resolve => {
    const check = () => {
      if (stopRef.current) { resolve(); return; }
      if (!pauseRef.current) { resolve(); return; }
      setTimeout(check, 200);
    };
    check();
  });

  // ── 全コマ生成 ──
  const handleGenerateAll = useCallback(async () => {
    const targets = panels.filter(p => p.status !== 'done');
    if (targets.length === 0) return;
    setIsGenerating(true);
    setIsPaused(false);
    stopRef.current = false;
    pauseRef.current = false;
    setProgress({ done: 0, total: targets.length });

    for (let i = 0; i < targets.length; i++) {
      await waitWhilePaused();
      if (stopRef.current) break;
      const panel = targets[i];

      setPanels(prev => prev.map(p => p.id === panel.id ? { ...p, status: 'generating' } : p));

      const refs = collectRefs(panel);

      try {
        const url = await generate(panel.prompt, refs.length > 0 ? refs : undefined);
        setPanels(prev => prev.map(p =>
          p.id === panel.id
            ? { ...p, imageUrl: url || undefined, status: url ? 'done' : 'error' }
            : p
        ));
        if (url) setImgGenCount(prev => prev + 1);
      } catch (err) {
        console.error(`Panel ${panel.id} failed:`, err);
        setPanels(prev => prev.map(p =>
          p.id === panel.id ? { ...p, status: 'error' } : p
        ));
      }

      setProgress({ done: i + 1, total: targets.length });
    }

    setIsGenerating(false);
    setIsPaused(false);
  }, [panels, characters]);

  // ── 1コマ再生成 ──
  const handleRegenerate = useCallback(async (id: number) => {
    const panel = panels.find(p => p.id === id);
    if (!panel) return;

    setPanels(prev => prev.map(p => p.id === id ? { ...p, status: 'generating' } : p));

    const refs = collectRefs(panel);

    try {
      const url = await generate(panel.prompt, refs.length > 0 ? refs : undefined);
      setPanels(prev => prev.map(p =>
        p.id === id ? { ...p, imageUrl: url || undefined, status: url ? 'done' : 'error' } : p
      ));
      if (url) setImgGenCount(prev => prev + 1);
    } catch {
      setPanels(prev => prev.map(p => p.id === id ? { ...p, status: 'error' } : p));
    }
  }, [panels, characters]);

  // ── プロンプト編集 ──
  const handlePromptEdit = (id: number, prompt: string) => {
    setPanels(prev => prev.map(p => p.id === id ? { ...p, prompt } : p));
  };

  // ── 一時停止/再開 ──
  const handlePause = () => { pauseRef.current = true; setIsPaused(true); };
  const handleResume = () => { pauseRef.current = false; setIsPaused(false); };

  // ── 停止 ──
  const handleStop = () => { stopRef.current = true; pauseRef.current = false; setIsGenerating(false); setIsPaused(false); };

  // ── ZIP一括DL ──
  const handleDownloadZip = async () => {
    const done = panels.filter(p => p.imageUrl);
    if (done.length === 0) return;
    const zip = new JSZip();
    const folder = zip.folder('scenes')!;
    for (const p of done) {
      const b64 = p.imageUrl!.split(',')[1];
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      folder.file(`${String(p.id).padStart(3, '0')}_${p.shotType}.png`, bytes);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `villainess_scenes_${new Date().toISOString().slice(0, 10)}.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ── 1枚DL ──
  const handleDownloadSingle = (url: string, id: number) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `scene_${String(id).padStart(3, '0')}.png`;
    a.click();
  };

  const doneCount = panels.filter(p => p.status === 'done').length;

  // コスト計算（画像生成 + テキストAPI = トータル）
  const imgDoneUSD = imgGenCount * COST_PER_IMAGE;
  const imgEstimateUSD = panels.length * COST_PER_IMAGE;
  const totalSpentUSD = imgDoneUSD + textApiCostUSD;
  const totalEstimateUSD = imgEstimateUSD + textApiCostUSD;
  const totalSpentJPY = Math.round(totalSpentUSD * USD_TO_JPY);
  const totalEstimateJPY = Math.round(totalEstimateUSD * USD_TO_JPY);

  // ================================================================
  // UI
  // ================================================================
  return (
    <div className="min-h-screen flex flex-col">
      {/* ヘッダー */}
      <header className="glass sticky top-0 z-40 px-6 py-3 flex items-center justify-between border-b border-white/5">
        <h1 className="text-sm font-bold tracking-widest text-purple-300">
          悪役令嬢シーンジェネレーター
        </h1>
        <div className="flex items-center gap-3">
          {/* モデル表示 */}
          <span className="text-[10px] px-3 py-1 rounded-full font-bold bg-purple-500/20 text-purple-400 border border-purple-500/30">
            Nano Banana 2
          </span>

          {/* コスト表示（内訳付き：AI選定 + 画像生成 = トータル） */}
          {panels.length > 0 && (
            <div className="text-[10px] text-right leading-tight space-y-0.5">
              <div className="text-white/30">
                見積: <span className="text-yellow-400 font-bold">¥{totalEstimateJPY.toLocaleString()}</span>
                <span className="text-white/20 ml-1">(${totalEstimateUSD.toFixed(2)})</span>
              </div>
              {(imgGenCount > 0 || textApiCostUSD > 0) && (
                <div className="text-white/20">
                  使用済: <span className="text-yellow-400/70">¥{totalSpentJPY.toLocaleString()}</span>
                  <span className="ml-1">(${totalSpentUSD.toFixed(2)})</span>
                </div>
              )}
              <div className="text-white/15 text-[9px] flex gap-2 justify-end">
                {textApiCostUSD > 0 && (
                  <span>AI選定: ${textApiCostUSD.toFixed(3)}</span>
                )}
                <span>画像: ${imgGenCount > 0 ? imgDoneUSD.toFixed(2) : imgEstimateUSD.toFixed(2)}{imgGenCount === 0 ? '(見積)' : `(${imgGenCount}回)`}</span>
              </div>
            </div>
          )}

          {doneCount > 0 && (
            <button onClick={handleDownloadZip} className="btn btn-ghost">
              ZIP ({doneCount}枚)
            </button>
          )}

          {panels.length > 0 && (
            isGenerating ? (
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-white/40">
                  {progress.done}/{progress.total}
                </span>
                {isPaused ? (
                  <button onClick={handleResume} className="btn bg-green-600 text-white">
                    再開
                  </button>
                ) : (
                  <button onClick={handlePause} className="btn bg-yellow-600 text-white">
                    一時停止
                  </button>
                )}
                <button onClick={handleStop} className="btn bg-red-600 text-white">
                  停止
                </button>
              </div>
            ) : (
              <button onClick={handleGenerateAll} className="btn btn-primary">
                全コマ生成 ({panels.filter(p => p.status !== 'done').length}枚)
              </button>
            )
          )}
        </div>
      </header>

      <div className="flex-1 flex">
        {/* 左: 設定パネル */}
        <aside className="w-[360px] shrink-0 border-r border-white/5 glass overflow-y-auto">
          <div className="p-5 space-y-6">
            {/* CSV読み込み */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-white/30 uppercase tracking-widest block">
                1. シナリオCSV読み込み
              </label>
              <label className="flex items-center justify-center gap-2 p-4 border-2 border-dashed border-white/10 rounded-xl cursor-pointer hover:border-purple-500/30 hover:bg-purple-500/5 transition-all">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/30"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
                <span className="text-xs text-white/40 font-bold">
                  {csvLoaded ? csvName : 'CSVファイルを選択'}
                </span>
                <input type="file" accept=".csv" onChange={handleCSV} className="hidden" />
              </label>
              {csvLoaded && (
                <p className="text-[10px] text-green-400">
                  {panels.length}コマ検出 / {characters.length}キャラクター
                </p>
              )}
            </div>

            {/* AI厳選（自動実行済み。枚数変更して再選定可能） */}
            {csvLoaded && allRows.length > 0 && panels.length > 0 && (
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-white/30 uppercase tracking-widest block">
                  2. AI厳選（YouTube用）
                </label>
                <p className="text-[10px] text-purple-400">
                  {allRows.length}件 → {panels.length}件に厳選済み
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={targetCount}
                    onChange={e => setTargetCount(Math.max(1, parseInt(e.target.value) || 150))}
                    className="w-16 text-xs text-center bg-white/[0.06] border border-white/10 rounded-lg px-2 py-1.5 focus:outline-none focus:border-purple-500/40"
                    min={1}
                    max={allRows.length}
                  />
                  <span className="text-[10px] text-white/30">枚に変更</span>
                  <button
                    onClick={handleAISelect}
                    disabled={isSelecting}
                    className="btn btn-ghost text-[10px] disabled:opacity-50"
                  >
                    {isSelecting ? '選定中...' : '再選定'}
                  </button>
                </div>
              </div>
            )}

            {/* キャラクターシート */}
            {characters.length > 0 && (
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-white/30 uppercase tracking-widest block">
                  3. キャラクターシート
                </label>
                <CharacterSetup
                  characters={characters}
                  onChange={handleCharUpdate}
                  onCostAdd={(cost) => setTextApiCostUSD(prev => prev + cost)}
                />
              </div>
            )}
          </div>
        </aside>

        {/* 右: コマ一覧 */}
        <main className="flex-1 overflow-y-auto p-5">
          {panels.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full opacity-20 gap-4">
              {isSelecting ? (
                <>
                  <div className="w-10 h-10 border-2 border-purple-500/40 border-t-purple-400 rounded-full animate-spin" />
                  <p className="text-sm text-purple-300/60">Gemini 3.1 Pro がシーンを厳選中...</p>
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                  <p className="text-sm">CSVを読み込むとコマ一覧が表示されます</p>
                </>
              )}
            </div>
          ) : (
            <PanelList
              panels={panels}
              onRegenerate={handleRegenerate}
              onDownload={handleDownloadSingle}
              onPreview={setPreviewUrl}
              onPromptEdit={handlePromptEdit}
            />
          )}
        </main>
      </div>

      {/* プレビューモーダル */}
      {previewUrl && <ImagePreview url={previewUrl} onClose={() => setPreviewUrl(null)} />}
    </div>
  );
};

export default App;
