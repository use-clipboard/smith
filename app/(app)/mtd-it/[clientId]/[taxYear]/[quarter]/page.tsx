import MtdItQuarterPage from '@/components/features/mtd-it/MtdItQuarterPage';

interface RouteParams {
  params: { clientId: string; taxYear: string; quarter: string };
}

export default function Page({ params }: RouteParams) {
  const taxYear = parseInt(params.taxYear, 10);
  const q       = parseInt(params.quarter, 10);
  if (!Number.isFinite(taxYear) || taxYear < 2026 || ![1, 2, 3, 4].includes(q)) {
    return (
      <div className="p-6">
        <h2 className="text-lg font-semibold text-gray-900">Invalid quarter URL</h2>
        <p className="text-sm text-gray-500 mt-1">Open the quarter from the MTD IT dashboard.</p>
      </div>
    );
  }
  return <MtdItQuarterPage clientId={params.clientId} taxYear={taxYear} quarter={q as 1 | 2 | 3 | 4} />;
}
