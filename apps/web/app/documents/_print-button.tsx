'use client';

export function PrintDocumentButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-control border border-rule px-3 py-2 text-fine font-semibold text-ink hover:bg-page focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple print:hidden"
    >
      Печать / PDF
    </button>
  );
}
