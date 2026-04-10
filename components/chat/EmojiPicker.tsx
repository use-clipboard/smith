'use client';

const EMOJI_GROUPS = [
  { label: 'Smileys', emojis: ['😀','😂','😍','🥰','😎','🤔','😅','😭','😡','🥳','😢','😤','🤣','😊','😬','😴','🤯','🥺','😏','🙄','😋','🤑','😜','🤪','🧐','🤓','😵','🤤','😇','🤩'] },
  { label: 'Hands', emojis: ['👍','👎','👏','🙏','👋','💪','🤝','✌️','🤞','👌','🤙','☝️','👆','👇','👈','👉','🤜','🤛','🤚','✋'] },
  { label: 'Symbols', emojis: ['❤️','🔥','⭐','💯','✅','❌','🎉','🚀','💡','🏆','💰','🎯','⚡','💎','🌟','🎊','🔔','📌','💬','🔑'] },
];

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  compact?: boolean;
}

export default function EmojiPicker({ onSelect, compact = false }: EmojiPickerProps) {
  if (compact) {
    const allEmojis = EMOJI_GROUPS[0].emojis.slice(0, 16).concat(EMOJI_GROUPS[1].emojis.slice(0, 8)).concat(EMOJI_GROUPS[2].emojis.slice(0, 8));
    return (
      <div className="bg-[var(--bg-card-solid)] border border-[var(--border)] rounded-xl shadow-2xl p-2 w-52">
        <div className="grid grid-cols-8 gap-0.5">
          {allEmojis.map((emoji, i) => (
            <button
              key={i}
              onClick={() => onSelect(emoji)}
              className="w-6 h-6 flex items-center justify-center text-sm rounded hover:bg-[var(--bg-nav-hover)] transition-all"
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[var(--bg-card-solid)] border border-[var(--border)] rounded-xl shadow-2xl p-3 w-72">
      {EMOJI_GROUPS.map(group => (
        <div key={group.label} className="mb-2 last:mb-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5 px-0.5">
            {group.label}
          </p>
          <div className="grid grid-cols-10 gap-0.5">
            {group.emojis.map((emoji, i) => (
              <button
                key={i}
                onClick={() => onSelect(emoji)}
                className="w-7 h-7 flex items-center justify-center text-base rounded hover:bg-[var(--bg-nav-hover)] transition-all"
                title={emoji}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
