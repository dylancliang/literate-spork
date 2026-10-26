import Papa from "papaparse";
import type { Dataset } from "./types";

/** Decode raw bytes. Chinese CSVs are often saved as GBK by Excel, not UTF-8, so we try both. */
export function decodeBytes(bytes: Uint8Array): { text: string; encoding: string } {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const hasBom = text.charCodeAt(0) === 0xfeff;
    return { text: hasBom ? text.slice(1) : text, encoding: hasBom ? "UTF-8 (with BOM)" : "UTF-8" };
  } catch {
    // gb18030 is a superset of GBK and GB2312.
    return { text: new TextDecoder("gb18030").decode(bytes), encoding: "GBK / GB18030" };
  }
}

export function parseCsv(fileName: string, bytes: Uint8Array): Dataset {
  const { text, encoding } = decodeBytes(bytes);
  const result = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
  const all = result.data.filter((r) => Array.isArray(r));
  if (all.length < 2) throw new Error("The file needs a header row and at least one data row.");

  const width = Math.max(...all.map((r) => r.length));
  const seen = new Map<string, number>();
  const headers = Array.from({ length: width }, (_, i) => {
    let h = (all[0][i] ?? "").trim() || `column_${i + 1}`;
    const n = seen.get(h) ?? 0;
    seen.set(h, n + 1);
    if (n > 0) h = `${h}_${n + 1}`;
    return h;
  });
  // Every cell stays a string, so IDs like "007" and dates are never reformatted.
  const rows = all.slice(1).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));

  return {
    fileName,
    encoding,
    delimiter: describeDelimiter(result.meta.delimiter),
    headers,
    rows,
  };
}

function describeDelimiter(d: string): string {
  if (d === ",") return "comma";
  if (d === "\t") return "tab";
  if (d === ";") return "semicolon";
  return JSON.stringify(d);
}

/** UTF-8 with a BOM, so Excel shows Chinese and German characters correctly when the file is double-clicked. */
export function toCsv(headers: string[], rows: string[][]): string {
  return "﻿" + Papa.unparse({ fields: headers, data: rows }, { newline: "\r\n" });
}
