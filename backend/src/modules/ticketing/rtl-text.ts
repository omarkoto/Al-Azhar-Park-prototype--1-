/**
 * Right-to-left text for PDFKit. PDFKit joins Arabic letters correctly (the font does that) but does not reorder
 * mixed text: words come out in the wrong order and numbers back to front. The ticket only needs short lines made of
 * Arabic words, numbers and Latin references, so this small layout does exactly that:
 *
 *   - the line is cut into runs: Arabic letters (drawn as one piece), numbers / Latin text (drawn left to right,
 *     because a number inside Arabic text still reads left to right) and punctuation;
 *   - runs are placed from the right edge towards the left, in reading order;
 *   - a bracket is drawn mirrored, as it appears in right-to-left text.
 */
type Doc = PDFKit.PDFDocument;

type Run = { kind: 'arabic' | 'ltr' | 'space' | 'other'; text: string };

const RUN_PATTERN = /([؀-ٟ٪-ۿݐ-ݿ]+)|([0-9A-Za-z٠-٩۰-۹][0-9A-Za-z٠-٩۰-۹.,:/+_\-–]*)|(\s+)|([\s\S])/gu;

const MIRROR: Record<string, string> = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '«': '»', '»': '«' };

export function splitRuns(text: string): Run[] {
  const runs: Run[] = [];
  for (const m of text.matchAll(RUN_PATTERN)) {
    if (m[1]) runs.push({ kind: 'arabic', text: m[1] });
    else if (m[2]) runs.push({ kind: 'ltr', text: m[2] });
    else if (m[3]) runs.push({ kind: 'space', text: ' ' });
    else runs.push({ kind: 'other', text: MIRROR[m[4]] ?? m[4] });
  }
  return runs;
}

const runWidth = (doc: Doc, r: Run) => doc.widthOfString(r.text);

/** Cuts a logical line into lines no wider than `width`, breaking only at spaces. */
export function wrapRuns(doc: Doc, text: string, width: number): Run[][] {
  const lines: Run[][] = [[]];
  let used = 0;
  // a "word" is everything between spaces
  const words: Run[][] = [[]];
  for (const r of splitRuns(text)) {
    if (r.kind === 'space') words.push([]);
    else words[words.length - 1].push(r);
  }
  const space = doc.widthOfString(' ');
  for (const word of words.filter((w) => w.length > 0)) {
    const w = word.reduce((n, r) => n + runWidth(doc, r), 0);
    const current = lines[lines.length - 1];
    if (current.length > 0 && used + space + w > width) {
      lines.push([...word]);
      used = w;
    } else {
      if (current.length > 0) current.push({ kind: 'space', text: ' ' });
      current.push(...word);
      used += (current.length > word.length ? space : 0) + w;
    }
  }
  return lines;
}

/** Draws one already-cut line ending at `rightX`. */
function drawLine(doc: Doc, runs: Run[], rightX: number, y: number): void {
  let x = rightX;
  for (const r of runs) {
    if (r.kind === 'space') {
      x -= doc.widthOfString(' ');
      continue;
    }
    if (r.kind === 'arabic' || r.kind === 'other') {
      x -= runWidth(doc, r);
      doc.text(r.text, x, y, { lineBreak: false });
    } else {
      // numbers and Latin text: left to right, one character at a time so the font cannot reverse them
      const total = runWidth(doc, r);
      let cx = x - total;
      for (const ch of r.text) {
        doc.text(ch, cx, y, { lineBreak: false });
        cx += doc.widthOfString(ch);
      }
      x -= total;
    }
  }
}

/**
 * Draws right-aligned Arabic text in the current font and size, wrapping at `width`.
 * Returns the height used. Pass `measureOnly` to get the height without drawing.
 */
export function drawRtl(doc: Doc, text: string, rightX: number, y: number, width: number, measureOnly = false): number {
  const lineHeight = doc.currentLineHeight(true);
  const lines = wrapRuns(doc, text, width);
  if (!measureOnly) lines.forEach((line, i) => drawLine(doc, line, rightX, y + i * lineHeight));
  return lines.length * lineHeight;
}
