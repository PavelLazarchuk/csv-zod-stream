const LF = 0x0a;
const CR = 0x0d;
const QUOTE = 0x22;
const COMMA = 0x2c;
const TAB = 0x09;
const SEMICOLON = 0x3b;
const BOM = [0xef, 0xbb, 0xbf];

export const SNIFF_LIMIT = 65_536;

export interface LineScanner {
    push(chunk: Uint8Array): number;

    readonly start: number;
}

export function byteOf(char: string | undefined, fallback = -1): number {
    if (char === undefined) return fallback;
    if (char.length !== 1) return -1;

    const code = char.charCodeAt(0);

    return code < 0x80 ? code : -1;
}

/**
 * Looks for the end of the first line across a series of chunks, carrying the
 * quote state between them so nothing has to be re-scanned or re-joined.
 *
 * Scanning raw bytes is safe: every byte of a multi-byte UTF-8 sequence has its
 * high bit set, so it can never be mistaken for `"` or `\n`.
 */
export function createLineScanner(quote = QUOTE, comment = -1): LineScanner {
    let quoted = false;
    let scanned = 0;
    let found = -1;
    let start = 0;
    let head = -1;

    return {
        get start() {
            return start;
        },

        push(chunk) {
            if (found !== -1) return found;

            for (let i = 0; i < chunk.length; i++) {
                const byte = chunk[i] as number;
                const offset = scanned + i;

                if (offset < BOM.length && byte === BOM[offset]) continue;

                if (byte === quote) {
                    quoted = !quoted;
                    if (head === -1) head = byte;
                } else if (byte === LF && !quoted) {
                    if (head !== -1 && head !== comment) return (found = offset);

                    start = offset + 1;
                    head = -1;
                } else if (head === -1 && byte !== CR) head = byte;
            }

            scanned += chunk.length;

            return -1;
        },
    };
}

/** One-shot {@link createLineScanner} over a buffer that is already whole. */
export function firstLineEnd(bytes: Uint8Array): number {
    return createLineScanner().push(bytes);
}

/**
 * Picks the delimiter that occurs most often outside quotes on the sample line.
 * A heuristic — ties and delimiter-free single-column files fall back to `,`.
 */
export function detectDelimiter(line: Uint8Array, quote?: string): string {
    const quoteByte = byteOf(quote, QUOTE);
    let comma = 0;
    let tab = 0;
    let semicolon = 0;
    let quoted = false;

    for (let i = 0; i < line.length; i++) {
        const byte = line[i];

        if (byte === quoteByte) quoted = !quoted;
        else if (quoted) continue;
        else if (byte === COMMA) comma++;
        else if (byte === TAB) tab++;
        else if (byte === SEMICOLON) semicolon++;
    }

    if (tab > comma && tab >= semicolon) return '\t';
    if (semicolon > comma && semicolon > tab) return ';';

    return ',';
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
