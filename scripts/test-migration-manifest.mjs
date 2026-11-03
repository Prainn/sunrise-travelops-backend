// Compare actual release compiler output, without connecting to a database.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const expected = JSON.parse(
  execFileSync(
    process.execPath,
    ['scripts/check-migration-names.mjs', '--manifest'],
    { encoding: 'utf8' },
  ),
);
const actual = {};
for (const file of readdirSync('dist/migrations').filter((name) =>
  name.endsWith('.js'),
)) {
  const path = resolve('dist/migrations', file);
  for (const Type of Object.values(require(path))) {
    if (typeof Type !== 'function' || !Type.prototype.up) continue;
    const name = new Type().name || Type.name;
    assert.equal(actual[name], undefined, `Duplicate migration ${name}`);
    actual[name] = createHash('sha256')
      .update(readFileSync(path))
      .digest('hex');
  }
}
assert.deepEqual(
  actual,
  expected,
  'Precheck manifest must match the real application build',
);
console.log(
  `Compiled migration manifest matches ${Object.keys(actual).length} release migrations.`,
);
