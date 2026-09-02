import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createLineScanner, detectDelimiter, sampleOf } from '../src/detect';
import { collect } from './helpers';

const bytes = (text: string) => new TextEncoder().encode(text);

const Row = z.object({ name: z.string(), note: z.string() });

describe('createLineScanner', () => {
    it('ignores line feeds inside a quoted field', () => {
        const scanner = createLineScanner();

        expect(scanner.push(bytes('a,"x\ny"\nb'))).toBe(true);
        expect(scanner.ranges).toEqual([{ start: 0, end: 7 }]);
    });

    it('reports nothing while the line is still incomplete', () => {
        const scanner = createLineScanner();

        expect(scanner.push(bytes('a,"x'))).toBe(false);
        expect(scanner.ranges).toEqual([]);
    });
});

describe('createLineScanner ranges', () => {
    it('carries quote state across chunks', () => {
        const scanner = createLineScanner();
        const chunks = ['a,"x', '\ny"', ',b\nc'].map(bytes);

        expect(chunks.map(chunk => scanner.push(chunk))).toEqual([false, false, true]);
        expect(scanner.ranges).toEqual([{ start: 0, end: 9 }]);
    });

    it('keeps reporting the line it already found', () => {
        const scanner = createLineScanner();

        expect(scanner.push(bytes('a\nb'))).toBe(true);
        expect(scanner.push(bytes('\n'))).toBe(true);
        expect(scanner.ranges).toEqual([{ start: 0, end: 1 }]);
    });

    it('skips blank lines and comment lines ahead of the sample', () => {
        const scanner = createLineScanner({ comment: 0x23 });

        expect(scanner.push(bytes('\r\n# c, o, m\n\na;b\n'))).toBe(true);
        expect(scanner.ranges).toEqual([{ start: 13, end: 16 }]);
    });

    it('ends a line on a lone CR', () => {
        const scanner = createLineScanner({ comment: 0x23 });

        expect(scanner.push(bytes('# a,b,c,d\rname;note\ra;b\r'))).toBe(true);
        expect(scanner.ranges).toEqual([{ start: 10, end: 19 }]);
    });

    it('skips a leading BOM before deciding a line is a comment', () => {
        const scanner = createLineScanner({ comment: 0x23 });

        expect(scanner.push(bytes('\uFEFF# c\na;b\n'))).toBe(true);
        expect(scanner.ranges).toEqual([{ start: 7, end: 10 }]);
    });

    it('tracks a custom quote character', () => {
        const scanner = createLineScanner({ quote: 0x27 });

        expect(scanner.push(bytes("'a\nb'\nc"))).toBe(true);
        expect(scanner.ranges).toEqual([{ start: 0, end: 5 }]);
    });

    it('collects several lines and joins them into a sample', () => {
        const input = bytes('a;b\n# note\nc;d\ne;f\n');
        const scanner = createLineScanner({ comment: 0x23, lines: 3 });

        expect(scanner.push(input)).toBe(true);
        expect(new TextDecoder().decode(sampleOf(input, scanner.ranges))).toBe('a;b\nc;d\ne;f');
    });

    it('takes an unterminated last line when asked to finish', () => {
        const scanner = createLineScanner({ lines: 2 });

        expect(scanner.push(bytes('a;b'))).toBe(false);
        scanner.finish(3);
        expect(scanner.ranges).toEqual([{ start: 0, end: 3 }]);
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

    it('sniffs a file with CR-only line endings', async () => {
        const text = '# a, b, c, d\rname;note\ra;b\r';
        const rows = await collect(Row, text, { delimiter: 'auto', comment: '#' });

        expect(rows).toEqual([{ name: 'a', note: 'b' }]);
    });

    it('is not fooled by a header that carries the wrong separator', async () => {
        const text = 'name, full;age;city\na;1;x\nb;2;y\nc;3;z\n';
        const rows = await collect(z.object({ age: z.coerce.number() }), text, {
            delimiter: 'auto',
        });

        expect(rows).toEqual([{ age: 1 }, { age: 2 }, { age: 3 }]);
    });

    it('sniffs a pipe-separated file', async () => {
        const rows = await collect(Row, 'name|note\na|b\n', { delimiter: 'auto' });

        expect(rows).toEqual([{ name: 'a', note: 'b' }]);
    });

    it('keeps to one line when that is all the file has', async () => {
        const rows = await collect(Row, 'name\tnote\na\tb\n', { delimiter: 'auto' });

        expect(rows).toEqual([{ name: 'a', note: 'b' }]);
    });

    it('counts a separator behind a custom escape as content', async () => {
        const text = 'name;note\n"a\\";b";c\n';
        const rows = await collect(Row, text, { delimiter: 'auto', escape: '\\' });

        expect(rows).toEqual([{ name: 'a";b', note: 'c' }]);
    });

    it('samples the last line even without a trailing break', async () => {
        const rows = await collect(z.object({ age: z.coerce.number() }), 'name, full;age\na;1', {
            delimiter: 'auto',
        });

        expect(rows).toEqual([{ age: 1 }]);
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
