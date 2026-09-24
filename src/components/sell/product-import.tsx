"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert } from "@/components/ui/primitives";
import { useI18n } from "@/components/i18n/i18n-provider";
import { api, ApiError } from "@/lib/api-client";
import { csvRecords } from "@/lib/csv";
import { MAX_IMPORT_ROWS, PRODUCT_IMPORT_COLUMNS, PRODUCT_IMPORT_TEMPLATE } from "@/lib/product-import";

interface ImportResult {
  applied: boolean;
  created: number;
  updated: number;
  errors: { row: number; column?: string; message: string }[];
}

/**
 * Catalogue import. The file is read in the browser first so the seller sees
 * how many rows it holds before sending it; the server re-parses and is the
 * only judge of what is valid.
 */
export function ProductImport({ shopId, entitled }: { shopId: string; entitled: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string; rows: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!entitled) {
    return (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-fg-muted">
          {t("Import or update hundreds of products from one spreadsheet. Included with Seller Pro.")}
        </p>
        <ButtonLink href="/pricing" variant="outline" size="sm">
          {t("See Seller Pro")}
        </ButtonLink>
      </div>
    );
  }

  function downloadTemplate() {
    // The byte-order mark makes Excel open the file as UTF-8, so Arabic
    // product names are not garbled.
    const blob = new Blob(["﻿" + PRODUCT_IMPORT_TEMPLATE], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "petmate-products-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function choose(files: FileList | null) {
    setResult(null);
    setError(null);
    const chosen = files?.[0];
    if (!chosen) return;
    if (chosen.size > 850_000) {
      setError(t("That file is too large. Split it into files of up to {count} rows.", { count: MAX_IMPORT_ROWS }));
      return;
    }
    const text = await chosen.text();
    setFile({ name: chosen.name, text, rows: csvRecords(text).records.length });
  }

  async function submit() {
    if (!file) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.post<ImportResult>("/api/store", { action: "import-products", shopId, csv: file.text });
      setResult(res);
      if (res.applied) {
        setFile(null);
        if (input.current) input.current.value = "";
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("The import could not be sent. Try again."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-fg-muted">
        {t("A row with a SKU you already use updates that product, so the same spreadsheet keeps your stock and prices current. Any other row adds a new product. Prices are in pounds. If any row has a problem, nothing is imported and you get the list to fix.")}
      </p>

      <p className="text-xs text-fg-subtle">
        {t("Columns:")} <code dir="ltr" className="font-mono">{PRODUCT_IMPORT_COLUMNS.join(", ")}</code>
      </p>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>
          <Download className="size-4" aria-hidden />
          {t("Download template")}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
          <FileSpreadsheet className="size-4" aria-hidden />
          {t("Choose a CSV file")}
        </Button>
        <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => void choose(e.target.files)} />
      </div>

      {file && (
        <div className="flex flex-col gap-3 rounded-[var(--radius-field)] border border-[var(--border)] p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-fg">
            <span className="font-medium" dir="ltr">{file.name}</span>
            <span className="text-fg-muted"> · {t.plural(file.rows, { one: "{count} row", other: "{count} rows" })}</span>
          </p>
          <Button size="sm" onClick={() => void submit()} loading={submitting} loadingText={t("Importing…")} disabled={file.rows === 0}>
            <Upload className="size-4" aria-hidden />
            {t("Import")}
          </Button>
        </div>
      )}

      {error && <Alert tone="danger">{error}</Alert>}

      {result?.applied && (
        <Alert tone="success" title={t("Import complete")}>
          {t("{created} added and {updated} updated.", { created: result.created, updated: result.updated })}
        </Alert>
      )}

      {result && !result.applied && (
        <Alert tone="danger" title={t("Nothing was imported")}>
          <p>{t("Fix these rows and import the file again:")}</p>
          <ul className="mt-2 max-h-60 space-y-1 overflow-y-auto">
            {result.errors.map((e, i) => (
              <li key={i}>
                <span className="font-semibold tabular">{t("Row {row}", { row: e.row })}</span>
                {e.column && <span dir="ltr"> ({e.column})</span>}: {e.message}
              </li>
            ))}
          </ul>
        </Alert>
      )}
    </div>
  );
}
