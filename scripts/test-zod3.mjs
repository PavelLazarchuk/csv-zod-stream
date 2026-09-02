import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const legacy = process.argv[2] ?? 'zod@3';
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

function run(command, args) {
    const { status } = spawnSync(command, args, {
        stdio: 'inherit',
        shell: process.platform === 'win32',
    });

    return status ?? 1;
}

function install(spec) {
    return run('npm', ['install', '--no-save', '--no-audit', '--no-fund', spec]);
}

if (install(legacy) !== 0) process.exit(1);

const status = run('npx', ['vitest', 'run']);

install(`zod@${pkg.devDependencies.zod}`);

process.exit(status);
