// Shared shell for the legal pages (Privacy Policy, Terms of Service). Renders a
// white bento-style panel matching the rest of the marketing site, with simple
// typographic styling so we don't depend on the typography plugin.
export default function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mx-auto w-full max-w-3xl rounded-3xl bg-white p-8 shadow-sm sm:p-12">
      <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">{title}</h1>
      <p className="mt-2 text-sm text-slate-400">Last updated: {updated}</p>
      <div
        className="mt-8 space-y-5 text-[15px] leading-relaxed text-slate-600
          [&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-slate-900
          [&_h3]:mt-6 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-slate-900
          [&_a]:font-medium [&_a]:text-primary-600 [&_a]:underline
          [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-6
          [&_strong]:font-semibold [&_strong]:text-slate-900"
      >
        {children}
      </div>
    </section>
  );
}
