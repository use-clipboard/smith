'use client';

import { useState } from 'react';

export interface DonutSlice {
  id: string;
  label: string;
  value: number;
  color: string;
}

interface Props {
  slices: DonutSlice[];
  size?: number;
  thickness?: number;
  centerTitle?: string;
  centerValue?: string;
  /** Formats the hovered slice value for the centre readout. */
  formatValue?: (value: number) => string;
}

const polar = (cx: number, cy: number, r: number, angle: number) => {
  const a = (angle - 90) * (Math.PI / 180);
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
};

function arcPath(cx: number, cy: number, rOuter: number, rInner: number, start: number, end: number): string {
  // Guard against a full-circle single slice (360° arc renders as nothing).
  const sweep = end - start;
  const e = sweep >= 360 ? start + 359.99 : end;
  const p1 = polar(cx, cy, rOuter, start);
  const p2 = polar(cx, cy, rOuter, e);
  const p3 = polar(cx, cy, rInner, e);
  const p4 = polar(cx, cy, rInner, start);
  const large = sweep > 180 ? 1 : 0;
  return [
    `M ${p1.x} ${p1.y}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${p2.x} ${p2.y}`,
    `L ${p3.x} ${p3.y}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${p4.x} ${p4.y}`,
    'Z',
  ].join(' ');
}

export default function DonutChart({
  slices, size = 180, thickness = 26, centerTitle, centerValue, formatValue,
}: Props) {
  const [hover, setHover] = useState<string | null>(null);
  const total = slices.reduce((s, x) => s + x.value, 0);
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2 - 2;
  const rInner = rOuter - thickness;

  let cursor = 0;
  const arcs = slices
    .filter(s => s.value > 0)
    .map(s => {
      const start = (cursor / total) * 360;
      cursor += s.value;
      const end = (cursor / total) * 360;
      return { ...s, start, end };
    });

  const active = hover ? slices.find(s => s.id === hover) : null;
  const titleText = active ? active.label : centerTitle;
  const valueText = active
    ? (formatValue ? formatValue(active.value) : String(active.value))
    : centerValue;

  return (
    <div className="flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
        {total === 0 && (
          <circle cx={cx} cy={cy} r={(rOuter + rInner) / 2} fill="none" stroke="#E5E7EB" strokeWidth={thickness} />
        )}
        {arcs.map(a => {
          const dim = hover && hover !== a.id;
          return (
            <path
              key={a.id}
              d={arcPath(cx, cy, rOuter, rInner, a.start, a.end)}
              fill={a.color}
              opacity={dim ? 0.35 : 1}
              className="transition-[opacity,transform] duration-200 cursor-pointer"
              style={{
                transformOrigin: `${cx}px ${cy}px`,
                transform: hover === a.id ? 'scale(1.04)' : 'scale(1)',
              }}
              onMouseEnter={() => setHover(a.id)}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}
        <text x={cx} y={cy - 4} textAnchor="middle" className="fill-[var(--text-primary)]" style={{ fontSize: 20, fontWeight: 700 }}>
          {valueText ?? ''}
        </text>
        <text x={cx} y={cy + 15} textAnchor="middle" className="fill-[var(--text-muted)]" style={{ fontSize: 11, fontWeight: 500 }}>
          {titleText ?? ''}
        </text>
      </svg>
    </div>
  );
}
