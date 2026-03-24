import React from 'react';
import { Character } from '../types';

interface Props {
  characters: Character[];
  onChange: (updated: Character[]) => void;
}

const CharacterSetup: React.FC<Props> = ({ characters, onChange }) => {
  const handleImageUpload = (name: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      onChange(characters.map(c =>
        c.name === name ? { ...c, imageUrl: reader.result as string } : c
      ));
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-2">
      <label className="text-[10px] font-bold text-white/30 uppercase tracking-widest block">
        2. キャラクターシート
      </label>
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
            {/* 名前 */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold truncate">{c.name}</p>
              <p className="text-[10px] text-white/30">
                {c.imageUrl ? 'シートあり' : 'クリックしてアップロード'}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CharacterSetup;
