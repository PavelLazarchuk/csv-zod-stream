const LF = 0x0a;
const CR = 0x0d;
const QUOTE = 0x22;
const BOM = [0xef, 0xbb, 0xbf];

const CANDIDATES = [0x2c, 0x3b, 0x09, 0x7c];
const DELIMITERS = [',', ';', '\t', '|'];

export const SNIFF_LIMIT = 65_536;
export const SNIFF_LINES = 5;

export interface LineRange {
    start: number;
    end: number;
}

export interface LineScanner {
    push(chunk: Uint8Array): boolean;
    finish(end: number): void;
    readonly ranges: readonly LineRange[];
}

export interface ScannerOptions {
    quote?: number;
    escape?: number;
    comment?: number;
    lines?: number;
}

export function byteOf(char: string | undefined, fallback = -1): number {
    if (char === undefined) return fallback;
    if (char.length !== 1) return -1;

    const code = char.charCodeAt(0);

    return code < 0x80 ? code : -1;
}

/**
 * Finds the record lines of a sample across a series of chunks, carrying the
 * quote state between them so nothing has to be re-scanned or re-joined.
 * Comment and blank lines are stepped over, the way the parser will.
 *
 * Scanning raw bytes is safe: every byte of a multi-byte UTF-8 sequence has its
 * high bit set, so it can never be mistaken for `"` or `\n`.
 */
export function createLineScanner(options: ScannerOptions = {}): LineScanner {
    const { quote = QUOTE, escape = quote, comment = -1, lines = 1 } = options;
    const ranges: LineRange[] = [];

    let quoted = false;
    let escaped = false;
    let scanned = 0;
    let start = 0;
    let head = -1;
    let afterCr = false;
    let done = false;

    return {
        ranges,

        finish(end) {
            if (done || head === -1 || head === comment || end <= start) return;

            ranges.push({ start, end });
        },

        push(chunk) {
            if (done) return true;

            for (let i = 0; i < chunk.length; i++) {
                const byte = chunk[i] as number;
                const offset = scanned + i;

                if (offset < BOM.length && byte === BOM[offset]) {
                    start = offset + 1;
                    continue;
                }

                if (afterCr) {
                    afterCr = false;

                    // The line already ended at the CR; an LF right behind it
                    // is the other half of a CRLF, not a second break.
                    if (byte === LF) {
                        start = offset + 1;
                        continue;
                    }
                }

                if (escaped) {
                    escaped = false;
                    continue;
                }

                if (quoted && byte === escape && escape !== quote) {
                    escaped = true;
                    continue;
                }

                if (byte === quote) {
                    quoted = !quoted;
                    if (head === -1) head = byte;
                } else if ((byte === LF || byte === CR) && !quoted) {
                    afterCr = byte === CR;

                    if (head !== -1 && head !== comment) {
                        ranges.push({ start, end: offset });

                        if (ranges.length >= lines) return (done = true);
                    }

                    start = offset + 1;
                    head = -1;
                } else if (head === -1) head = byte;
            }

            scanned += chunk.length;

            return false;
        },
    };
}

/** Copies the scanned lines into one buffer, separated by a line feed. */
export function sampleOf(bytes: Uint8Array, ranges: readonly LineRange[]): Uint8Array {
    let size = 0;
    for (const range of ranges) size += range.end - range.start + 1;

    const sample = new Uint8Array(Math.max(size - 1, 0));
    let offset = 0;

    for (const range of ranges) {
        if (offset > 0) sample[offset++] = LF;

        sample.set(bytes.subarray(range.start, range.end), offset);
        offset += range.end - range.start;
    }

    return sample;
}

function countPerLine(sample: Uint8Array, quote: number, escape: number): number[][] {
    const lines: number[][] = [];
    let counts = CANDIDATES.map(() => 0);
    let filled = false;
    let quoted = false;
    let escaped = false;

    for (const byte of sample) {
        if (escaped) {
            escaped = false;
            continue;
        }

        if (quoted && byte === escape && escape !== quote) {
            escaped = true;
            continue;
        }

        if (byte === quote) {
            quoted = !quoted;
            filled = true;
        } else if (!quoted && (byte === LF || byte === CR)) {
            if (filled) lines.push(counts);

            counts = CANDIDATES.map(() => 0);
            filled = false;
        } else {
            const index = CANDIDATES.indexOf(byte);

            if (index !== -1 && !quoted) (counts[index] as number)++;
            filled = true;
        }
    }

    if (filled) lines.push(counts);

    return lines;
}

/**
 * Picks the delimiter that occurs the same number of times on every sampled
 * line, which is what a real delimiter does and what a stray separator inside a
 * field does not. Falls back to sheer frequency, then to `,`.
 */
export function detectDelimiter(sample: Uint8Array, quote?: string, escape?: string): string {
    const quoteByte = byteOf(quote, QUOTE);
    const lines = countPerLine(sample, quoteByte, byteOf(escape, quoteByte));

    if (lines.length === 0) return ',';

    const pick = (score: (index: number) => number, eligible: (index: number) => boolean) => {
        let chosen = -1;
        let best = 0;

        for (let index = 0; index < CANDIDATES.length; index++) {
            const value = eligible(index) ? score(index) : 0;

            if (value > best) {
                best = value;
                chosen = index;
            }
        }

        return chosen;
    };

    const first = lines[0] as number[];
    const consistent = pick(
        index => first[index] as number,
        index => lines.every(line => line[index] === first[index])
    );

    if (consistent !== -1) return DELIMITERS[consistent] as string;

    const frequent = pick(
        index => lines.reduce((sum, line) => sum + (line[index] as number), 0),
        () => true
    );

    return frequent === -1 ? ',' : (DELIMITERS[frequent] as string);
}

export function concat(chunks: readonly Uint8Array[]): Uint8Array {
    if (chunks.length === 1) return chunks[0] as Uint8Array;

    let size = 0;
    for (const chunk of chunks) size += chunk.length;

    const merged = new Uint8Array(size);
    let offset = 0;

    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
    }

    return merged;
}
