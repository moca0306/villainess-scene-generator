import React, { useState, useRef, useCallback } from 'react';
import JSZip from 'jszip';
import { Character, Panel, ImageModel } from './types';
import { parseCSV, extractCharacterNames, buildPanels } from './services/engine';
import { generate, setModel } from './services/imageGen';
import CharacterSetup from './components/CharacterSetup';
import PanelList from './components/PanelList';
import ImagePreview from './components/ImagePreview';

// 1枚あたりのコスト（USD、1K解像度）
const COST_PER_IMAGE: Record<ImageModel, number> = {
  flash: 0.067,  // Nano Banana 2
  pro: 0.134,    // Nano Banana Pro
};
const USD_TO_JPY = 150; // おおよそのレート

const App: React.FC = () => {
  // ── 状態 ──
  const [characters, setCharacters] = useState<Character[]>([]);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [csvLoaded, setCsvLoaded] = useState(false);
  const [csvName, setCsvName] = useState('');
  const [imageModelSel, setImageModelSel] = useState<ImageModel>('flash');
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const stopRef = useRef(false);

  // ── CSV読み込み ──
  const handleCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const text = reader.result as string;
      const rows = parseCSV(text);
      const names = extractCharacterNames(rows);
      setCharacters(names.map(n => ({ name: n })));
      // パネルはキャラシートアップロード後に構築するのでここではrowsだけ保持
      setPanels(buildPanels(rows, []));
      setCsvLoaded(true);
      setCsvName(file.name);
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

  // ── モデル変更 ──
  const handleModelChange = (m: ImageModel) => {
    setImageModelSel(m);
    setModel(m);
  };

  // ── 全コマ生成 ──
  const handleGenerateAll = useCallback(async () => {
    const targets = panels.filter(p => p.status !== 'done');
    if (targets.length === 0) return;
    setIsGenerating(true);
    stopRef.current = false;
    setProgress({ done: 0, total: targets.length });

    for (let i = 0; i < targets.length; i++) {
      if (stopRef.current) break;
      const panel = targets[i];

      setPanels(prev => prev.map(p => p.id === panel.id ? { ...p, status: 'generating' } : p));

      // リファレンス画像を収集
      const charBase = panel.character.replace(/[（(].+?[）)]/g, '').trim();
      const refs = characters
        .filter(c => c.imageUrl && c.name === charBase)
        .map(c => c.imageUrl!);

      try {
        const url = await generate(panel.prompt, refs.length > 0 ? refs : undefined);
        setPanels(prev => prev.map(p =>
          p.id === panel.id
            ? { ...p, imageUrl: url || undefined, status: url ? 'done' : 'error' }
            : p
        ));
      } catch (err) {
        console.error(`Panel ${panel.id} failed:`, err);
        setPanels(prev => prev.map(p =>
          p.id === panel.id ? { ...p, status: 'error' } : p
        ));
      }

      setProgress({ done: i + 1, total: targets.length });
    }

    setIsGenerating(false);
  }, [panels, characters]);

  // ── 1コマ再生成 ──
  const handleRegenerate = useCallback(async (id: number) => {
    const panel = panels.find(p => p.id === id);
    if (!panel) return;

    setPanels(prev => prev.map(p => p.id === id ? { ...p, status: 'generating' } : p));

    const charBase = panel.character.replace(/[（(].+?[）)]/g, '').trim();
    const refs = characters
      .filter(c => c.imageUrl && c.name === charBase)
      .map(c => c.imageUrl!);

    try {
      const url = await generate(panel.prompt, refs.length > 0 ? refs : undefined);
      setPanels(prev => prev.map(p =>
        p.id === id ? { ...p, imageUrl: url || undefined, status: url ? 'done' : 'error' } : p
      ));
    } catch {
      setPanels(prev => prev.map(p => p.id === id ? { ...p, status: 'error' } : p));
    }
  }, [panels, characters]);

  // ── 停止 ──
  const handleStop = () => { stopRef.current = true; setIsGenerating(false); };

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
  const remainingCount = panels.filter(p => p.status !== 'done').length;

  // コスト計算
  const costPerImage = COST_PER_IMAGE[imageModelSel];
  const costDoneUSD = doneCount * costPerImage;
  const costTotalUSD = panels.length * costPerImage;
  const costDoneJPY = Math.round(costDoneUSD * USD_TO_JPY);
  const costTotalJPY = Math.round(costTotalUSD * USD_TO_JPY);

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
          {/* モデル切替 */}
          <div className="flex items-center gap-1 text-[10px]">
            {(['flash', 'pro'] as ImageModel[]).map(m => (
              <button
                key={m}
                onClick={() => handleModelChange(m)}
                className={`px-3 py-1 rounded-full font-bold transition-all ${
                  imageModelSel === m
                    ? m === 'flash'
                      ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                      : 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                    : 'text-white/30 hover:text-white/50'
                }`}
              >
                {m === 'flash' ? 'Nano Banana 2' : 'Nano Banana Pro'}
              </button>
            ))}
          </div>

          {/* コスト表示 */}
          {panels.length > 0 && (
            <div className="text-[10px] text-right leading-tight">
              <div className="text-white/30">
                全{panels.length}枚: <span className="text-yellow-400 font-bold">¥{costTotalJPY.toLocaleString()}</span>
                <span className="text-white/20 ml-1">(${costTotalUSD.toFixed(2)})</span>
              </div>
              {doneCount > 0 && (
                <div className="text-white/20">
                  使用済: <span className="text-yellow-400/70">¥{costDoneJPY.toLocaleString()}</span>
                  <span className="ml-1">(${costDoneUSD.toFixed(2)})</span>
                </div>
              )}
            </div>
          )}

          {doneCount > 0 && (
            <button onClick={handleDownloadZip} className="btn btn-ghost">
              ZIP ({doneCount}枚)
            </button>
          )}

          {panels.length > 0 && (
            isGenerating ? (
              <button onClick={handleStop} className="btn bg-red-600 text-white animate-pulse">
                停止 ({progress.done}/{progress.total})
              </button>
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

            {/* キャラクターシート */}
            {characters.length > 0 && (
              <CharacterSetup characters={characters} onChange={handleCharUpdate} />
            )}
          </div>
        </aside>

        {/* 右: コマ一覧 */}
        <main className="flex-1 overflow-y-auto p-5">
          {panels.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full opacity-20 gap-4">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
              <p className="text-sm">CSVを読み込むとコマ一覧が表示されます</p>
            </div>
          ) : (
            <PanelList
              panels={panels}
              onRegenerate={handleRegenerate}
              onDownload={handleDownloadSingle}
              onPreview={setPreviewUrl}
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
