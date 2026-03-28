import React, { useState } from 'react';
import { Panel } from '../types';

interface Props {
  panels: Panel[];
  onRegenerate: (id: number) => void;
  onDownload: (url: string, id: number) => void;
  onPreview: (url: string) => void;
  onPromptEdit: (id: number, prompt: string) => void;
}

const COMP_COLORS: Record<string, string> = {
  asymmetric_split: 'bg-cyan-500/15 text-cyan-400',
  triangle_stable: 'bg-green-500/15 text-green-400',
  triangle_inverted: 'bg-red-500/15 text-red-400',
  diagonal_dynamic: 'bg-orange-500/15 text-orange-400',
  wide_angle_dramatic: 'bg-purple-500/15 text-purple-400',
  telephoto_compressed: 'bg-blue-500/15 text-blue-400',
  low_angle_power: 'bg-rose-500/15 text-rose-400',
  high_angle_overview: 'bg-sky-500/15 text-sky-400',
  over_shoulder: 'bg-amber-500/15 text-amber-400',
  silhouette_dramatic: 'bg-violet-500/15 text-violet-400',
  foreground_frame: 'bg-emerald-500/15 text-emerald-400',
  extreme_closeup_emotion: 'bg-pink-500/15 text-pink-400',
};

const PanelList: React.FC<Props> = ({ panels, onRegenerate, onDownload, onPreview, onPromptEdit }) => {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');

  // シーンでグループ化
  const groups: { scene: string; panels: Panel[] }[] = [];
  let currentScene = '';
  for (const p of panels) {
    if (p.scene !== currentScene) {
      currentScene = p.scene;
      groups.push({ scene: p.scene, panels: [] });
    }
    groups[groups.length - 1].panels.push(p);
  }

  return (
    <div className="space-y-6">
      {/* サマリー */}
      <div className="flex items-center gap-4 text-xs text-white/40">
        <span>{panels.length}コマ</span>
        <span>{panels.filter(p => p.status === 'done').length}枚生成済み</span>
        <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-purple-500 to-violet-400 transition-all duration-500"
            style={{ width: `${(panels.filter(p => p.status === 'done').length / panels.length) * 100}%` }}
          />
        </div>
      </div>

      {groups.map((g, gi) => (
        <div key={gi} className="space-y-2">
          {/* シーンヘッダー */}
          <div className="sticky top-0 z-10 glass px-4 py-2 rounded-lg">
            <h3 className="text-xs font-bold text-purple-300">{g.scene}</h3>
            <span className="text-[10px] text-white/30">{g.panels.length}コマ</span>
          </div>

          {/* コマグリッド */}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {g.panels.map(p => (
              <div
                key={p.id}
                className="group glass rounded-xl overflow-hidden border border-white/5 hover:border-purple-500/20 transition-all"
              >
                {/* 画像エリア */}
                <div className="aspect-video relative bg-white/[0.02]">
                  {p.status === 'done' && p.imageUrl ? (
                    <>
                      <img
                        src={p.imageUrl}
                        alt={`#${p.id}`}
                        className="w-full h-full object-cover cursor-zoom-in"
                        onClick={() => onPreview(p.imageUrl!)}
                      />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button onClick={() => onRegenerate(p.id)} className="btn btn-ghost text-[9px]">再生成</button>
                        <button onClick={() => onDownload(p.imageUrl!, p.id)} className="btn btn-ghost text-[9px]">保存</button>
                      </div>
                    </>
                  ) : p.status === 'generating' ? (
                    <div className="w-full h-full flex items-center justify-center">
                      <div className="w-8 h-1 bg-white/10 rounded-full overflow-hidden">
                        <div className="w-full h-full bg-purple-500 animate-pulse" />
                      </div>
                    </div>
                  ) : p.status === 'error' ? (
                    <div className="w-full h-full flex items-center justify-center">
                      <button onClick={() => onRegenerate(p.id)} className="text-red-400 text-[10px] font-bold">
                        エラー — 再試行
                      </button>
                    </div>
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                      <span className="text-white/10 text-[10px]">待機中</span>
                      <button
                        onClick={() => onRegenerate(p.id)}
                        className="text-[10px] px-3 py-1 rounded-full bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-all font-bold"
                      >
                        生成
                      </button>
                    </div>
                  )}
                </div>

                {/* 情報 */}
                <div className="p-2.5 space-y-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-bold text-white/25">#{p.id}</span>
                    <span className="text-[8px] font-bold px-1.5 py-0.5 rounded border border-white/10 text-white/40">
                      {p.shotTypeLabel}
                    </span>
                    <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${COMP_COLORS[p.composition] || 'text-white/30'}`}>
                      {p.compositionLabel}
                    </span>
                  </div>

                  {p.character && (
                    <p className="text-[10px] text-white/40 truncate">{p.character}</p>
                  )}

                  <p className="text-[10px] text-white/25 line-clamp-2">{p.situation}</p>

                  {p.dialogue && (
                    <p className="text-[10px] text-purple-300/50 whitespace-pre-wrap">「{p.dialogue}」</p>
                  )}

                  {/* プロンプト展開・編集 */}
                  <button
                    onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                    className="text-[9px] text-white/20 hover:text-white/40 transition-colors"
                  >
                    {expandedId === p.id ? 'プロンプト ▲' : 'プロンプト ▼'}
                  </button>
                  {expandedId === p.id && (
                    editingId === p.id ? (
                      <div className="space-y-1">
                        <textarea
                          value={editDraft}
                          onChange={e => setEditDraft(e.target.value)}
                          className="w-full text-[9px] text-white/60 bg-white/[0.06] p-2 rounded-lg overflow-auto max-h-60 min-h-[80px] whitespace-pre-wrap font-mono border border-purple-500/30 focus:outline-none focus:border-purple-500/60 resize-y"
                        />
                        <div className="flex gap-1">
                          <button
                            onClick={() => { onPromptEdit(p.id, editDraft); setEditingId(null); }}
                            className="text-[9px] px-2 py-0.5 rounded bg-purple-500/20 text-purple-400 hover:bg-purple-500/30"
                          >
                            保存
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="text-[9px] px-2 py-0.5 rounded bg-white/5 text-white/30 hover:bg-white/10"
                          >
                            キャンセル
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        onClick={() => { setEditingId(p.id); setEditDraft(p.prompt); }}
                        className="text-[9px] text-white/20 bg-white/[0.03] p-2 rounded-lg overflow-auto max-h-40 whitespace-pre-wrap font-mono cursor-pointer hover:bg-white/[0.06] hover:text-white/30 transition-colors"
                        title="クリックで編集"
                      >
                        {p.prompt}
                      </div>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default PanelList;
