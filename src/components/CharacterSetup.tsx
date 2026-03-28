import React, { useState } from 'react';
import { Character } from '../types';
import { analyzeCharacterSheet } from '../services/charAnalyzer';

interface Props {
  characters: Character[];
  onChange: (updated: Character[]) => void;
  onCostAdd?: (costUSD: number) => void;
}

const CharacterSetup: React.FC<Props> = ({ characters, onChange, onCostAdd }) => {
  const [analyzingName, setAnalyzingName] = useState<string | null>(null);

  const handleImageUpload = (name: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = async () => {
      const imageUrl = reader.result as string;

      // まず画像をセット
      onChange(characters.map(c =>
        c.name === name ? { ...c, imageUrl } : c
      ));

      // 外見テキストを自動解析
      setAnalyzingName(name);
      try {
        const result = await analyzeCharacterSheet(imageUrl);
        onChange(characters.map(c =>
          c.name === name ? { ...c, imageUrl, appearance: result.appearance } : c
        ));
        if (result.costUSD > 0 && onCostAdd) onCostAdd(result.costUSD);
      } catch (err) {
        console.warn('Character analysis failed:', err);
      }
      setAnalyzingName(null);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-2">
      <div className="space-y-3">
        {characters.map(c => (
          <div key={c.name} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5">
            {/* サムネ */}
            <label className="shrink-0 cursor-pointer">
              {c.imageUrl ? (
                <img src={c.imageUrl} alt={c.name} className="w-12 h-12 rounded-lg object-cover border border-purple-500/30" />
              ) : (
                <div className="w-12 h-12 rounded-lg border border-dashed border-white/15 flex items-center justify-center text-white/20 text-[10px] hover:border-purple-500/30 transition-all">
                  +
                </div>
              )}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload(c.name, e)} />
            </label>
            {/* 名前と解析状態 */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold truncate">{c.name}</p>
              <p className="text-[10px] text-white/30">
                {analyzingName === c.name
                  ? '外見を解析中...'
                  : c.appearance
                    ? '外見解析済み'
                    : c.imageUrl
                      ? 'シートあり'
                      : 'クリックしてアップロード'}
              </p>
              {c.appearance && (
                <p className="text-[9px] text-white/20 mt-1 line-clamp-2">{c.appearance}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CharacterSetup;
