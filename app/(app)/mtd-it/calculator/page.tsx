import MtdItCalculator from '@/components/features/mtd-it/MtdItCalculator';

// Standalone MTD IT P&L calculator — purely in-memory. No DB writes, no
// uploads, no client linkage required. Useful for "what if I add £500 of
// income here?" sanity checks, and for working through a non-client's
// numbers without polluting real records.
export default function MtdItCalculatorPage() {
  return <MtdItCalculator />;
}
