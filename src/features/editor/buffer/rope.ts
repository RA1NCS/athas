// Chunked rope buffer. UTF-16 char offsets to match JS string indexing.
// Files are split into ~64 KB chunks; chunk boundaries land on \n where
// possible. Char/line counts are cached as prefix sums for O(log N) random
// access. Edits invalidate the affected chunks plus prefix sums tail.
//
// Not a persistent rope — mutations rewrite the chunk list. Snapshotting is
// done by holding old chunk arrays (cheap; chunks are immutable strings).

const CHUNK_TARGET = 64 * 1024;
const CHUNK_MAX = 128 * 1024;
const CHUNK_MIN = 16 * 1024;

function countLines(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 10) n++;
  }
  return n;
}

// Split a string into balanced chunks, preferring \n boundaries.
function chunkString(s: string): string[] {
  if (s.length <= CHUNK_MAX) return [s];
  const chunks: string[] = [];
  let i = 0;
  while (i < s.length) {
    let end = Math.min(i + CHUNK_TARGET, s.length);
    if (end < s.length) {
      const nl = s.lastIndexOf("\n", end);
      if (nl > i + CHUNK_MIN) end = nl + 1;
    }
    chunks.push(s.slice(i, end));
    i = end;
  }
  return chunks;
}

// 32-bit FNV-1a over chunks. Used for dirty checks; collision risk negligible
// for our scale (one hash per buffer per save).
function fnv1a(chunks: string[]): number {
  let h = 0x811c9dc5;
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++) {
      h ^= c.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return h >>> 0;
}

export class Rope {
  private chunks: string[];
  // prefixLen[i] = total chars in chunks [0..=i]
  private prefixLen: number[];
  // prefixLines[i] = total \n in chunks [0..=i]
  private prefixLines: number[];
  // lazy materialized full string
  private cachedStr: string | null = null;
  private cachedHash: number | null = null;

  private constructor(chunks: string[]) {
    this.chunks = chunks;
    this.prefixLen = [];
    this.prefixLines = [];
    this.rebuildPrefix(0);
  }

  static fromString(s: string): Rope {
    return new Rope(chunkString(s));
  }

  static empty(): Rope {
    return new Rope([]);
  }

  get length(): number {
    const n = this.prefixLen.length;
    return n === 0 ? 0 : this.prefixLen[n - 1];
  }

  // 1 + total newlines. Empty buffer has 1 line.
  get lineCount(): number {
    const n = this.prefixLines.length;
    return 1 + (n === 0 ? 0 : this.prefixLines[n - 1]);
  }

  toString(): string {
    if (this.cachedStr === null) {
      this.cachedStr = this.chunks.join("");
    }
    return this.cachedStr;
  }

  hash(): number {
    if (this.cachedHash === null) {
      this.cachedHash = fnv1a(this.chunks);
    }
    return this.cachedHash;
  }

  // O(log chunks). Char offset → {chunk, offset within chunk}.
  private locateOffset(offset: number): { idx: number; local: number } {
    if (offset <= 0) return { idx: 0, local: 0 };
    if (offset >= this.length) {
      const last = this.chunks.length - 1;
      if (last < 0) return { idx: 0, local: 0 };
      return { idx: last, local: this.chunks[last].length };
    }
    let lo = 0;
    let hi = this.chunks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.prefixLen[mid] <= offset) lo = mid + 1;
      else hi = mid;
    }
    const prev = lo === 0 ? 0 : this.prefixLen[lo - 1];
    return { idx: lo, local: offset - prev };
  }

  slice(start: number, end: number): string {
    const len = this.length;
    if (start < 0) start = 0;
    if (end > len) end = len;
    if (start >= end) return "";
    const a = this.locateOffset(start);
    const b = this.locateOffset(end);
    if (a.idx === b.idx) return this.chunks[a.idx].slice(a.local, b.local);
    let out = this.chunks[a.idx].slice(a.local);
    for (let i = a.idx + 1; i < b.idx; i++) out += this.chunks[i];
    out += this.chunks[b.idx].slice(0, b.local);
    return out;
  }

  // 0-indexed line content (no trailing \n).
  lineAt(line: number): string {
    const start = this.lineStartOffset(line);
    const next = line + 1 >= this.lineCount ? this.length : this.lineStartOffset(line + 1);
    let end = next;
    if (end > start && this.charCodeAt(end - 1) === 10) end -= 1;
    return this.slice(start, end);
  }

  // Char offset where given line begins. 0-indexed.
  lineStartOffset(line: number): number {
    if (line <= 0) return 0;
    if (line >= this.lineCount) return this.length;
    // Find chunk containing the (line)th \n.
    const target = line; // need `line` newlines before this offset
    let lo = 0;
    let hi = this.chunks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.prefixLines[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const before = lo === 0 ? 0 : this.prefixLines[lo - 1];
    let remaining = target - before;
    const chunk = this.chunks[lo];
    let offsetInChunk = 0;
    for (let i = 0; i < chunk.length; i++) {
      if (chunk.charCodeAt(i) === 10) {
        remaining--;
        if (remaining === 0) {
          offsetInChunk = i + 1;
          break;
        }
      }
    }
    const chunkStart = lo === 0 ? 0 : this.prefixLen[lo - 1];
    return chunkStart + offsetInChunk;
  }

  // O(lineCount) helper. Use sparingly; prefer streaming via lineAt + lineCount.
  toLines(): string[] {
    return this.toString().split(/\r?\n/);
  }

  charCodeAt(offset: number): number {
    if (offset < 0 || offset >= this.length) return NaN;
    const { idx, local } = this.locateOffset(offset);
    return this.chunks[idx].charCodeAt(local);
  }

  // Replace [start, end) with text. Mutates in place.
  replace(start: number, end: number, text: string): void {
    const len = this.length;
    if (start < 0) start = 0;
    if (end > len) end = len;
    if (start > end) start = end;

    // Build the contiguous span around the edit, replace, re-chunk that span.
    const a = this.locateOffset(start);
    const b = this.locateOffset(end);

    // Take prefix of chunk a, edited text, suffix of chunk b.
    let span = "";
    if (this.chunks.length > 0) {
      span += this.chunks[a.idx].slice(0, a.local);
    }
    span += text;
    if (this.chunks.length > 0) {
      span += this.chunks[b.idx].slice(b.local);
    }

    const newSpanChunks = chunkString(span);
    const removeFrom = this.chunks.length === 0 ? 0 : a.idx;
    const removeCount = this.chunks.length === 0 ? 0 : b.idx - a.idx + 1;
    this.chunks.splice(removeFrom, removeCount, ...newSpanChunks);

    this.cachedStr = null;
    this.cachedHash = null;
    this.rebuildPrefix(removeFrom);
  }

  private rebuildPrefix(from: number): void {
    if (this.chunks.length === 0) {
      this.prefixLen.length = 0;
      this.prefixLines.length = 0;
      return;
    }
    this.prefixLen.length = this.chunks.length;
    this.prefixLines.length = this.chunks.length;
    let runLen = from === 0 ? 0 : this.prefixLen[from - 1];
    let runLines = from === 0 ? 0 : this.prefixLines[from - 1];
    for (let i = from; i < this.chunks.length; i++) {
      runLen += this.chunks[i].length;
      runLines += countLines(this.chunks[i]);
      this.prefixLen[i] = runLen;
      this.prefixLines[i] = runLines;
    }
  }
}
