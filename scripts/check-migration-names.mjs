import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataSource, MigrationExecutor } from 'typeorm';
import ts from 'typescript';
import { createHash } from 'node:crypto';

const historicalCalendarNames = new Map([
  ['20260901000000-InitializeBackend.ts', 'InitializeBackend20260901000000'],
  ['20260910180000-CreateLynxVisits.ts', 'CreateLynxVisits20260910180000'],
  [
    '20260914000000-CreateUserLoginRecords.ts',
    'CreateUserLoginRecords20260914000000',
  ],
]);

const directory = resolve(
  process.argv.slice(2).find((arg) => arg !== '--manifest') ??
    join(fileURLToPath(new URL('../src/migrations/', import.meta.url))),
);
const files = readdirSync(directory).filter((file) => file.endsWith('.ts'));
const names = [];

for (const file of files) {
  const match = /^(\d{13,14})-([A-Za-z][A-Za-z0-9]*)\.ts$/.exec(file);
  if (!match)
    throw new Error(
      `Migration filename must be <13-digit-ms>-<Class>.ts: ${file}`,
    );

  const [, timestamp, classBase] = match;
  const expectedName = `${classBase}${timestamp}`;
  const source = readFileSync(join(directory, file), 'utf8');
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const classes = sourceFile.statements.filter(
    (statement) =>
      ts.isClassDeclaration(statement) &&
      statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      ) &&
      statement.heritageClauses?.some(
        (clause) =>
          clause.token === ts.SyntaxKind.ImplementsKeyword &&
          clause.types.some(
            (type) =>
              type.expression.getText(sourceFile) === 'MigrationInterface',
          ),
      ),
  );
  if (classes.length !== 1 || classes[0].name?.text !== expectedName)
    throw new Error(`Migration class must be ${expectedName}: ${file}`);
  const instanceNames = classes[0].members.filter(
    (member) =>
      ts.isPropertyDeclaration(member) &&
      member.name.getText(sourceFile) === 'name',
  );
  if (
    instanceNames.length > 1 ||
    (instanceNames.length === 1 &&
      (!instanceNames[0].initializer ||
        !ts.isStringLiteral(instanceNames[0].initializer) ||
        instanceNames[0].initializer.text !== expectedName))
  )
    throw new Error(`Migration instance name must be ${expectedName}: ${file}`);

  if (
    timestamp.length === 14 &&
    historicalCalendarNames.get(file) !== expectedName
  )
    throw new Error(
      `New migration must use a 13-digit Unix millisecond timestamp: ${file}. ` +
        'TypeORM sorts by the final 13 digits of the class name.',
    );
  names.push({ name: expectedName });
}

for (const file of historicalCalendarNames.keys()) {
  if (!files.includes(file))
    throw new Error(`Historical migration name changed or removed: ${file}`);
}

// Use TypeORM's own timestamp extraction and duplicate-name check without connecting to a database.
const dataSource = new DataSource({
  type: 'postgres',
  database: 'migration-name-check',
  migrations: [],
});
dataSource.migrations = names;
const ordered = new MigrationExecutor(dataSource).getMigrations();
for (let index = 1; index < ordered.length; index++) {
  if (ordered[index].timestamp === ordered[index - 1].timestamp)
    throw new Error(
      `Migrations share TypeORM timestamp: ${ordered[index - 1].name}, ${ordered[index].name}`,
    );
}

if (process.argv.includes('--manifest')) {
  // Use the same compiler options and filenames as Nest's build. The release
  // gateway compares these bytes with the final image before accepting it.
  const configPath = fileURLToPath(
    new URL('../tsconfig.json', import.meta.url),
  );
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error)
    throw new Error(
      ts.flattenDiagnosticMessageText(config.error.messageText, '\n'),
    );
  const options = ts.convertCompilerOptionsFromJson(
    config.config.compilerOptions,
    resolve('.'),
  );
  if (options.errors.length)
    throw new Error('Invalid migration compiler options');
  const manifest = {};
  for (const file of files) {
    const [, timestamp, classBase] =
      /^(\d{13,14})-([A-Za-z][A-Za-z0-9]*)\.ts$/.exec(file);
    const output = ts.transpileModule(
      readFileSync(join(directory, file), 'utf8'),
      {
        compilerOptions: options.options,
        fileName: join(directory, file),
        reportDiagnostics: true,
      },
    );
    if (
      output.diagnostics?.some(
        (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
      )
    )
      throw new Error(`Migration transpilation failed: ${file}`);
    manifest[`${classBase}${timestamp}`] = createHash('sha256')
      .update(output.outputText)
      .digest('hex');
  }
  console.log(JSON.stringify(manifest));
} else
  console.log(
    `Migration names OK: ${ordered.length} total; ${historicalCalendarNames.size} immutable 14-digit exceptions; ` +
      `latest ${ordered.at(-1)?.name ?? 'none'}.`,
  );
