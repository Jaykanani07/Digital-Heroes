import { parse } from "csv-parse/sync";
import { badRequest } from "../lib/errors.js";

export const MAX_CSV_ROWS = 5000;

export interface ParsedCsv {
  columns: string[];
  rows: Record<string, string>[];
}

/**
 * Parses a variable-data CSV (§07). The first row must be a header. Values
 * are trimmed; empty lines are skipped. Throws a 400 with a clear message.
 */
export function parseCsv(buf: Buffer): ParsedCsv {
  let records: Record<string, string>[];
  try {
    records = parse(buf, {
      columns: (header: string[]) => header.map((h) => String(h).trim()),
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: true,
    });
  } catch (e) {
    throw badRequest(`That CSV couldn't be read: ${(e as Error).message.split("\n")[0]}`);
  }
  if (!records.length) throw badRequest("The CSV has no data rows under the header.");
  if (records.length > MAX_CSV_ROWS) throw badRequest(`The CSV has ${records.length} rows; the maximum is ${MAX_CSV_ROWS}.`);
  const columns = Object.keys(records[0]).filter((c) => c !== "");
  if (!columns.length) throw badRequest("The CSV needs a header row with column names.");
  if (columns.length > 30) throw badRequest("The CSV has too many columns (max 30).");
  const rows = records.map((r) => {
    const out: Record<string, string> = {};
    for (const c of columns) out[c] = r[c] == null ? "" : String(r[c]).slice(0, 200);
    return out;
  });
  return { columns, rows };
}
