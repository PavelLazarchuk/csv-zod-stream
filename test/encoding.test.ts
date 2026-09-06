import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createCsvValidator, parseCsv, parseCsvFile } from '../src/index';
import { parseCsv as webParseCsv } from '../src/web/index';
import { collect } from './helpers';

const Row = z.object({ name: z.string(), note: z.string() });

const cp1251 = new Uint8Array([
    ...Buffer.from('name,note\n', 'latin1'),
    0xcf,
    0xb8,
    0xf2,
    0xf0,
    0x2c,
    0x6f,
    0x6b,
    0x0a,
]);

describe('encoding', () => {
    it('decodes windows-1251 bytes', async () => {
        const { rows } = await parseCsv(cp1251, Row, { encoding: 'windows-1251' });

        expect(rows).toEqual([{ name: 'Пётр', note: 'ok' }]);
    });

    it('decodes latin1 bytes', async () => {
        const bytes = Buffer.from('name,note\ncafé,ok\n', 'latin1');

        const { rows } = await parseCsv(bytes, Row, { encoding: 'latin1' });

        expect(rows).toEqual([{ name: 'café', note: 'ok' }]);
    });

    it('carries a multi-byte character across a chunk boundary', async () => {
        expect(await collect(Row, 'name,note\nПётр,ok\n', { encoding: 'utf-8' }, 3)).toEqual([
            { name: 'Пётр', note: 'ok' },
        ]);
    });

    it('strips a BOM the decoder finds, and keeps it when bom is off', async () => {
        const bytes = Buffer.from('﻿name,note\na,b\n', 'utf8');

        expect((await parseCsv(bytes, Row, { encoding: 'utf-8' })).rows).toEqual([
            { name: 'a', note: 'b' },
        ]);

        const kept = await parseCsv(bytes, z.object({ note: z.string() }), {
            encoding: 'utf-8',
            bom: false,
            checkHeaders: false,
        });

        expect(kept.rows).toEqual([{ note: 'b' }]);
    });

    it('sniffs the delimiter on the decoded bytes', async () => {
        const bytes = new Uint8Array([
            ...Buffer.from('name;note\n', 'latin1'),
            0xcf,
            0xb8,
            0x3b,
            0x6f,
            0x6b,
            0x0a,
        ]);

        const { rows } = await parseCsv(bytes, Row, {
            encoding: 'windows-1251',
            delimiter: 'auto',
        });

        expect(rows).toEqual([{ name: 'Пё', note: 'ok' }]);
    });

    it('ignores the encoding when the input is already a string', async () => {
        const { rows } = await parseCsv('name,note\ncafé,ok\n', Row, { encoding: 'windows-1251' });

        expect(rows).toEqual([{ name: 'café', note: 'ok' }]);
    });

    it('reads a file off disk in its own encoding', async () => {
        const { writeFile, mkdtemp } = await import('node:fs/promises');
        const { join } = await import('node:path');
        const { tmpdir } = await import('node:os');

        const dir = await mkdtemp(join(tmpdir(), 'csv-zod-'));
        const path = join(dir, 'people.csv');

        await writeFile(path, cp1251);

        const { rows } = await parseCsvFile(path, Row, { encoding: 'windows-1251' });

        expect(rows).toEqual([{ name: 'Пётр', note: 'ok' }]);
    });

    it('rejects an encoding the runtime does not know', () => {
        expect(() => createCsvValidator(Row, { encoding: 'not-an-encoding' })).toThrow(RangeError);
    });

    it('decodes on the web build too', async () => {
        const { rows } = await webParseCsv(cp1251, Row, { encoding: 'windows-1251' });

        expect(rows).toEqual([{ name: 'Пётр', note: 'ok' }]);
    });
});
