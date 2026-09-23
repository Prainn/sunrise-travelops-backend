// Build the small preflight manifest from the same compiled migrations as the image.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const directory = path.resolve('dist/migrations');
const result = {};
for (const file of fs
  .readdirSync(directory)
  .filter((name) => name.endsWith('.js'))) {
  const full = path.join(directory, file);
  for (const Type of Object.values(require(full))) {
    if (typeof Type !== 'function' || !Type.prototype.up) continue;
    const name = new Type().name || Type.name;
    if (result[name]) throw new Error('Duplicate migration: ' + name);
    result[name] = crypto
      .createHash('sha256')
      .update(fs.readFileSync(full))
      .digest('hex');
  }
}
process.stdout.write(JSON.stringify(result));
