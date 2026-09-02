import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { collect } from './helpers';

const Row = z.object({ name: z.string(), note: z.string() });

describe('chunk boundaries', () => {
    it('keeps a quoted field with a newline together across 5-byte chunks', async () => {
        const rows = await collect(Row, 'name,note\na,"line one\nline two"\nb,plain\n');

        expect(rows).toEqual([
            { name: 'a', note: 'line one\nline two' },
            { name: 'b', note: 'plain' },
        ]);
    });

    it('survives one byte at a time', async () => {
        const rows = await collect(Row, 'name,note\na,"x\ny"\n', undefined, 1);

        expect(rows).toEqual([{ name: 'a', note: 'x\ny' }]);
    });

    it('does not split a multi-byte character', async () => {
        const rows = await collect(Row, 'name,note\nж,"日本\n語"\n', undefined, 3);

        expect(rows).toEqual([{ name: 'ж', note: '日本\n語' }]);
    });
});

describe('CSV shapes', () => {
    it('unescapes doubled quotes', async () => {
        const rows = await collect(Row, 'name,note\na,"say ""hi"""\n');

        expect(rows).toEqual([{ name: 'a', note: 'say "hi"' }]);
    });

    it('reads CRLF the same as LF', async () => {
        const crlf = await collect(Row, 'name,note\r\na,"x\r\ny"\r\nb,z\r\n');
        const lf = await collect(Row, 'name,note\na,"x\r\ny"\nb,z\n');

        expect(crlf).toEqual(lf);
        expect(crlf).toEqual([
            { name: 'a', note: 'x\r\ny' },
            { name: 'b', note: 'z' },
        ]);
    });

    it('strips a UTF-8 BOM from the first header', async () => {
        const rows = await collect(Row, '﻿name,note\na,b\n');

        expect(rows).toEqual([{ name: 'a', note: 'b' }]);
    });

    it('ignores blank lines in the middle of a file', async () => {
        const rows = await collect(Row, 'name,note\na,b\n\n\nc,d\n');

        expect(rows).toEqual([
            { name: 'a', note: 'b' },
            { name: 'c', note: 'd' },
        ]);
    });

    it('handles a file with no trailing newline', async () => {
        const rows = await collect(Row, 'name,note\na,b');

        expect(rows).toEqual([{ name: 'a', note: 'b' }]);
    });

    it('yields nothing for a header-only file', async () => {
        expect(await collect(Row, 'name,note\n')).toEqual([]);
    });

    it('takes column names from options when the file has no header', async () => {
        const rows = await collect(Row, 'a,b\nc,d\n', { headers: ['name', 'note'] });

        expect(rows).toEqual([
            { name: 'a', note: 'b' },
            { name: 'c', note: 'd' },
        ]);
    });

    it('keeps tabs inside a quoted TSV field', async () => {
        const rows = await collect(Row, 'name\tnote\na\t"has\ttab\nand break"\n', {
            delimiter: '\t',
        });

        expect(rows).toEqual([{ name: 'a', note: 'has\ttab\nand break' }]);
    });

    it('applies csv-parse passthrough options', async () => {
        const rows = await collect(Row, '# comment\nname,note\n  a  ,b\n', {
            comment: '#',
            trim: true,
        });

        expect(rows).toEqual([{ name: 'a', note: 'b' }]);
    });

    it('coerces through the schema', async () => {
        const Numbered = z.object({ name: z.string(), note: z.coerce.number() });
        const rows = await collect(Numbered, 'name,note\na,42\n');

        expect(rows).toEqual([{ name: 'a', note: 42 }]);
    });

    it('fails the stream on a structurally broken record', async () => {
        await expect(collect(Row, 'name,note\na,b,c\n')).rejects.toThrow(/columns length/i);
    });

    it('lets the schema judge ragged rows when relaxColumnCount is on', async () => {
        const Loose = z.object({ name: z.string(), note: z.string().optional() });
        const rows = await collect(Loose, 'name,note\na\nb,c\n', { relaxColumnCount: true });

        expect(rows).toEqual([{ name: 'a' }, { name: 'b', note: 'c' }]);
    });
});
