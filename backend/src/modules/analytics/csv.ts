/**
 * CSV for spreadsheets, written safely:
 *  - UTF-8 with a byte-order mark, so Excel shows Arabic correctly; rows end with CRLF (RFC 4180);
 *  - a cell with a comma, quote or line break is quoted, and quotes inside it are doubled;
 *  - a TEXT cell that starts with = + - @ (or a tab / carriage return) would be run as a formula by a spreadsheet, so it is
 *    prefixed with an apostrophe. Numbers are written as numbers and are never prefixed.
 */
export const CSV_BOM = '﻿';

export type CsvCell = string | number | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  // leading spaces would hide the trigger character from the check, so look past them
  let text = /^\s*[=+\-@]/.test(value) || FORMULA_START.test(value) ? `'${value}` : value;
  // a line break inside a cell is kept (inside quotes); stray NUL and other control characters are dropped
  // eslint-disable-next-line no-control-regex
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const csvLine = (cells: readonly CsvCell[]): string => `${cells.map(csvCell).join(',')}\r\n`;

/** The file, one line at a time, so it can be streamed instead of built in memory. */
export function* csvLines(headers: readonly string[], rows: Iterable<readonly CsvCell[]>): Generator<string> {
  yield CSV_BOM + csvLine(headers);
  for (const row of rows) yield csvLine(row);
}
