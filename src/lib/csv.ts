/**
 * CSV, per RFC 4180: comma-separated, fields optionally wrapped in double
 * quotes, a doubled quote inside a quoted field is a literal quote, and a
 * quoted field may contain commas and line breaks. Accepts CRLF or LF, and
 * strips the byte-order mark Excel writes at the start of a UTF-8 export
 * (which otherwise turns the first header into "﻿title").
 *
 * Client-safe, so the import screen can preview a file before sending it.
 */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i]!;

    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"' && field === "") {
      quoted = true;
      i++;
    } else if (ch === ",") {
      row.push(field);
      field = "";
      i++;
    } else if (ch === "\n" || ch === "\r") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += ch === "\r" && input[i + 1] === "\n" ? 2 : 1;
    } else {
      field += ch;
      i++;
    }
  }

  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }

  // Blank lines (a trailing newline, a spacer row) are not records.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** Rows as objects keyed by lower-cased, trimmed header names. */
export function csvRecords(text: string): { headers: string[]; records: Record<string, string>[] } {
  const [head, ...body] = parseCsv(text);
  if (!head) return { headers: [], records: [] };
  const headers = head.map((h) => h.trim().toLowerCase());
  const records = body.map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (h) record[h] = (cells[idx] ?? "").trim();
    });
    return record;
  });
  return { headers, records };
}

/** Quotes a value for CSV output when it needs it. */
export function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
