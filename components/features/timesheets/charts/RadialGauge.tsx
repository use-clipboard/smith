'use client';

interface Props {
  /** 0–1 (values above 1 are clamped for the ring but shown raw in the label). */
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  trackColor?: string;
  label?: string;
}

export default function RadialGauge({
  value, size = 64, stroke = 7, color = '#6366F1', trackColor = 'rgba(99,102,241,0.14)', label,
}: Props) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, value));
  const offset = c * (1 - clamped);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor} strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.22,1,0.36,1)' }}
        />
      </svg>
      {label != null && (
        <div className="absolute inset-0 flex items-center justify-center text-[13px] font-bold text-[var(--text-primary)]">
          {label}
        </div>
      )}
    </div>
  );
}
