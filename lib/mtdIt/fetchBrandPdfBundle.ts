// Client-side helper that fetches everything the PDF builders need that
// isn't already in memory in the modal:
//   - firm settings (brand colour + PDF content toggles)
//   - the logo as a data URL
//   - the quarterly-comparison rows for the cover page
//
// Each fetch is wrapped in try/catch and degrades to "no branding /
// no comparison" rather than throwing — the PDF must still render even
// if the firm hasn't configured anything yet.

export interface BrandPdfBundle {
  brandPrimaryColor: string | null;
  logoDataUrl:       string | null;
  pdfInclude: {
    kpiCards:            boolean;
    chart:               boolean;
    categoryTables:      boolean;
    breakdown:           boolean;
    transactionDetail:   boolean;
    quarterlyComparison: boolean;
  };
  comparison: Array<{ quarter: 1|2|3|4; income: number; expense: number; net: number; status: string }>;
}

interface FetchOpts {
  clientId: string;
  taxYear:  number;
  /** Optional: omit the current quarter from the comparison row set.
   *  We still include it (so all 4 quarters are visible side-by-side),
   *  but knowing which is "current" lets the row highlight stay correct. */
  currentQuarter?: 1 | 2 | 3 | 4;
}

const DEFAULT_INCLUDE: BrandPdfBundle['pdfInclude'] = {
  kpiCards: true, chart: true, categoryTables: true,
  breakdown: true, transactionDetail: true, quarterlyComparison: true,
};

export async function fetchBrandPdfBundle({ clientId, taxYear }: FetchOpts): Promise<BrandPdfBundle> {
  const [settingsRes, logoRes, compRes] = await Promise.allSettled([
    fetch('/api/mtd-it/firm-settings'),
    fetch('/api/mtd-it/firm-settings/logo'),
    fetch(`/api/mtd-it/quarters/comparison?client_id=${encodeURIComponent(clientId)}&tax_year=${taxYear}`),
  ]);

  let brandPrimaryColor: string | null = null;
  let pdfInclude = { ...DEFAULT_INCLUDE };
  if (settingsRes.status === 'fulfilled' && settingsRes.value.ok) {
    try {
      const j = await settingsRes.value.json();
      const s = j.settings ?? {};
      brandPrimaryColor = typeof s.brand_primary_color === 'string' ? s.brand_primary_color : null;
      pdfInclude = {
        kpiCards:            s.pdf_include_kpi_cards            ?? true,
        chart:               s.pdf_include_chart                ?? true,
        categoryTables:      s.pdf_include_category_tables      ?? true,
        breakdown:           s.pdf_include_breakdown            ?? true,
        transactionDetail:   s.pdf_include_transaction_detail   ?? true,
        quarterlyComparison: s.pdf_include_quarterly_comparison ?? true,
      };
    } catch { /* fall through to defaults */ }
  }

  let logoDataUrl: string | null = null;
  if (logoRes.status === 'fulfilled' && logoRes.value.ok) {
    try {
      const j = await logoRes.value.json();
      logoDataUrl = typeof j.logo === 'string' ? j.logo : null;
    } catch { /* skip */ }
  }

  let comparison: BrandPdfBundle['comparison'] = [];
  if (compRes.status === 'fulfilled' && compRes.value.ok) {
    try {
      const j = await compRes.value.json();
      comparison = Array.isArray(j.rows) ? j.rows : [];
    } catch { /* skip */ }
  }

  return { brandPrimaryColor, logoDataUrl, pdfInclude, comparison };
}
