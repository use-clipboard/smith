/**
 * Social-proof logo strip. Panel-content — a thin divider band between the
 * tools grid and the pain-points row inside the same bento panel.
 */
const FIRMS = [
  { name: 'Thomas & Co', sub: 'Chartered Accountants' },
  { name: 'miller.', sub: 'Accountancy' },
  { name: 'Greenwood', sub: '& Associates' },
  { name: 'Oakwood', sub: 'Accountants' },
  { name: 'Rowlands', sub: 'Chartered Accountants' },
];

export default function LogoStrip() {
  return (
    <div className="mt-14 border-t border-slate-100 px-6 py-10 sm:px-10 lg:px-14">
      <p className="text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
        Trusted by accountants at forward-thinking firms
      </p>
      <div className="mt-7 flex flex-wrap items-center justify-center gap-x-12 gap-y-6">
        {FIRMS.map((f) => (
          <div key={f.name} className="text-center opacity-55 transition-opacity hover:opacity-100">
            <div className="text-lg font-bold tracking-tight text-slate-700">{f.name}</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400">{f.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
