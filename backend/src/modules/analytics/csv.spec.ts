import { CSV_BOM, csvCell, csvLine, csvLines } from './csv';

describe('csv cells', () => {
  it('leaves plain text and numbers alone', () => {
    expect(csvCell('Adult')).toBe('Adult');
    expect(csvCell(150)).toBe('150');
    expect(csvCell(0)).toBe('0');
    expect(csvCell(12.5)).toBe('12.5');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(Number.NaN)).toBe('');
  });

  it('quotes a cell with a comma, a quote or a line break, and doubles the quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"');
    expect(csvCell('line one\r\nline two')).toBe('"line one\r\nline two"');
    expect(csvCell('"')).toBe('""""');
  });

  it('keeps Arabic text as it is', () => {
    expect(csvCell('البوابة الرئيسية')).toBe('البوابة الرئيسية');
    expect(csvCell('مصري، مقيم')).toBe('مصري، مقيم'); // the Arabic comma is not a separator
    expect(csvCell('بالغ, طفل')).toBe('"بالغ, طفل"');
  });

  it('defuses text a spreadsheet would run as a formula', () => {
    for (const bad of ['=1+1', '+SUM(A1:A9)', '-2+3', '@SUM(1)', '=HYPERLINK("http://evil","x")', '\t=1', '\r=1', ' =1+1', '  @x']) {
      const cell = csvCell(bad);
      expect(cell.replace(/^"/, '').startsWith("'")).toBe(true);
    }
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe('"\'=HYPERLINK(""http://evil"",""x"")"');
    expect(csvCell("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
  });

  it('does not touch text that only contains those characters later on, or numbers', () => {
    expect(csvCell('Adult - Resident')).toBe('Adult - Resident');
    expect(csvCell('a=b')).toBe('a=b');
    expect(csvCell('e-mail@x')).toBe('e-mail@x');
    expect(csvCell(-5)).toBe('-5'); // a number, written as a number
  });

  it('drops control characters but keeps the text', () => {
    expect(csvCell('a\u0000b\u0007c')).toBe('abc');
  });
});

describe('a csv file', () => {
  it('starts with a byte-order mark and the headers, ends every row with CRLF, in a fixed column order', () => {
    const text = [...csvLines(['date', 'tickets', 'name'], [['2026-10-07', 3, 'Adult'], ['2026-10-08', 0, 'Child, 2-8']])].join('');
    expect(text.startsWith(`${CSV_BOM}date,tickets,name\r\n`)).toBe(true);
    expect(text.split('\r\n')).toEqual([`${CSV_BOM}date,tickets,name`, '2026-10-07,3,Adult', '2026-10-08,0,"Child, 2-8"', '']);
  });

  it('is a valid UTF-8 byte stream for Arabic, readable by a spreadsheet', () => {
    const bytes = Buffer.from([...csvLines(['name'], [['مصري / مقيم']])].join(''), 'utf8');
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.toString('utf8')).toContain('مصري / مقيم');
  });

  it('writes an empty report as just its header row', () => {
    expect([...csvLines(['a', 'b'], [])].join('')).toBe(`${CSV_BOM}a,b\r\n`);
  });

  it('one line is one row', () => {
    expect(csvLine(['a', 'b,c', 3])).toBe('a,"b,c",3\r\n');
  });
});
