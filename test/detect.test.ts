import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createLineScanner, detectDelimiter, firstLineEnd } from '../src/detect';
import { collect } from './helpers';

const bytes = (text: string) => new TextEncoder().encode(text);

const Row = z.object({ name: z.string(), note: z.string() });

describe('firstLineEnd', () => {
    it('ignores line feeds inside a quoted field', () => {
        expect(firstLineEnd(bytes('a,"x\ny"\nb'))).toBe(7);
    });

    it('reports -1 while the line is still incomplete', () => {
        expect(firstLineEnd(bytes('a,"x'))).toBe(-1);
    });
});

describe('createLineScanner', () => {
    it('carries quote state across chunks', () => {
        const scanner = createLineScanner();
        const chunks = ['a,"x', '\ny"', ',b\nc'].map(bytes);

        expect(chunks.map(chunk => scanner.push(chunk))).toEqual([-1, -1, 9]);
    });

    it('keeps reporting the offset it already found', () => {
        const scanner = createLineScanner();

        expect(scanner.push(bytes('a\nb'))).toBe(1);
        expect(scanner.push(bytes('\n'))).toBe(1);
    });

    it('skips blank lines and comment lines ahead of the sample', () => {
        const scanner = createLineScanner(0x22, 0x23);

        expect(scanner.push(bytes('\r\n# c, o, m\n\na;b\n'))).toBe(16);
        expect(scanner.start).toBe(13);
    });

    it('skips a leading BOM before deciding a line is a comment', () => {
        const scanner = createLineScanner(0x22, 0x23);

        expect(scanner.push(bytes('\uFEFF# c\na;b\n'))).toBe(10);
        expect(scanner.start).toBe(7);
    });

    it('tracks a custom quote character', () => {
        const scanner = createLineScanner(0x27);

        expect(scanner.push(bytes("'a\nb'\nc"))).toBe(5);
    });
});

describe('detectDelimiter', () => {
    it.each([
        ['a,b,c', ','],
        ['a\tb\tc', '\t'],
        ['a;b;c', ';'],
        ['single', ','],
        ['', ','],
    ])('reads %j as %j', (line, expected) => {
        expect(detectDelimiter(bytes(line))).toBe(expected);
    });

    it('does not count separators inside quotes', () => {
        expect(detectDelimiter(bytes('"a;b;c;d"\tx'))).toBe('\t');
    });

    it('prefers the comma on a tie', () => {
        expect(detectDelimiter(bytes('a,b;c'))).toBe(',');
    });

    it('honours a custom quote character', () => {
        expect(detectDelimiter(bytes("'a;b;c;d'\tx"), "'")).toBe('\t');
    });

    it('treats an empty quote as no quoting', () => {
        expect(detectDelimiter(bytes('"a;b;c;d"\tx'), '')).toBe(';');
    });
});

describe("delimiter: 'auto'", () => {
    it.each([
        [',', 'name,note\na,b\n'],
        ['\t', 'name\tnote\na\tb\n'],
        [';', 'name;note\na;b\n'],
    ])('sniffs %j', async (_delimiter, text) => {
        expect(await collect(Row, text, { delimiter: 'auto' })).toEqual([{ name: 'a', note: 'b' }]);
    });

    it('sniffs across chunk boundaries', async () => {
        const rows = await collect(Row, 'name\tnote\na\t"x\ny"\n', { delimiter: 'auto' }, 1);

        expect(rows).toEqual([{ name: 'a', note: 'x\ny' }]);
    });

    it('handles a file that never reaches a second line', async () => {
        const rows = await collect(Row, 'name;note', { delimiter: 'auto' });

        expect(rows).toEqual([]);
    });

    it('handles an empty file', async () => {
        expect(await collect(Row, '', { delimiter: 'auto' })).toEqual([]);
    });

    it('sniffs a long quoted header one byte at a time', async () => {
        const padding = 'x'.repeat(20_000);
        const text = `"${padding}"\tnote\na\tb\n`;

        const rows = await collect(z.object({ note: z.string() }), text, { delimiter: 'auto' }, 1);

        expect(rows).toEqual([{ note: 'b' }]);
    });

    it('looks past comment and blank lines to find the header', async () => {
        const text = '# a, b, c\n\nname;note\na;b\n';
        const rows = await collect(Row, text, { delimiter: 'auto', comment: '#' });

        expect(rows).toEqual([{ name: 'a', note: 'b' }]);
    });

    it('respects the configured quote while sniffing', async () => {
        const text = "'na;me;x;y'\tnote\na\tb\n";
        const rows = await collect(z.object({ note: z.string() }), text, {
            delimiter: 'auto',
            quote: "'",
        });

        expect(rows).toEqual([{ note: 'b' }]);
    });
});
