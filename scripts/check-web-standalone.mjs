import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';

const SPECIFIER = /(?:from\s*|import\s*|require\(\s*)['"]([^'"]+)['"]/g;

async function specifiersReachableFrom(entry) {
    const seen = new Set();
    const external = new Set();
    const queue = [normalize(entry)];

    while (queue.length) {
        const file = queue.pop();

        if (seen.has(file)) continue;
        seen.add(file);

        const code = await readFile(file, 'utf8');

        for (const [, specifier] of code.matchAll(SPECIFIER)) {
            if (specifier.startsWith('.')) queue.push(normalize(join(dirname(file), specifier)));
            else external.add(specifier);
        }
    }

    return { files: seen, external };
}

let failed = false;

for (const entry of ['dist/web/index.js', 'dist/web/index.cjs']) {
    const { files, external } = await specifiersReachableFrom(entry);
    const nodeish = [...external].filter(
        name => name === 'node:stream' || name === 'stream' || name === 'csv-parse'
    );

    if (nodeish.length) {
        console.error(`${entry} reaches ${nodeish.join(', ')} (${files.size} file(s) scanned)`);
        failed = true;
    } else {
        console.log(`${entry}: node:stream-free across ${files.size} file(s).`);
    }
}

for (const entry of ['dist/index.js', 'dist/index.cjs']) {
    const { external } = await specifiersReachableFrom(entry);

    if (![...external].some(name => name === 'csv-parse')) {
        console.error(`${entry} does not import csv-parse — it should be external, not bundled.`);
        failed = true;
    } else {
        console.log(`${entry}: csv-parse stays external.`);
    }
}

if (failed) process.exit(1);
