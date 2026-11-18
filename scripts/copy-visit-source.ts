import 'reflect-metadata';
import { DataSource } from 'typeorm';
import {
  copyVisitSource,
  VisitCopyConflict,
} from '../src/lynx/visit-source-copy';

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--apply'))
    throw new Error('Only --apply is accepted; default is dry run');
  const sourceUrl = process.env.VISITS_COPY_SOURCE_URL;
  const targetUrl = process.env.VISITS_COPY_TARGET_URL;
  if (!sourceUrl || !targetUrl)
    throw new Error(
      'Both explicit VISITS_COPY_SOURCE_URL and VISITS_COPY_TARGET_URL are required; .env is not loaded',
    );
  const source = new DataSource({
    type: 'postgres',
    url: sourceUrl,
    synchronize: false,
    logging: false,
  });
  const target = new DataSource({
    type: 'postgres',
    url: targetUrl,
    synchronize: false,
    logging: false,
  });
  try {
    await source.initialize();
    await target.initialize();
    const [identity] = await target.query<{ database: string }[]>(
      'SELECT current_database() AS database',
    );
    if (
      args.includes('--apply') &&
      process.env.VISITS_COPY_CONFIRM_TARGET !== identity.database
    )
      throw new Error(
        'Applying requires VISITS_COPY_CONFIRM_TARGET equal to the actual target database name',
      );
    const report = await copyVisitSource(
      source,
      target,
      args.includes('--apply'),
    );
    console.log(
      JSON.stringify(
        {
          mode: args.includes('--apply') ? 'apply' : 'dry-run',
          targetDatabase: identity.database,
          ...report,
        },
        null,
        2,
      ),
    );
  } finally {
    if (source.isInitialized) await source.destroy();
    if (target.isInitialized) await target.destroy();
  }
}
void main().catch((error: unknown) => {
  // Never print connection URLs or copied attribution payloads.
  console.error(
    error instanceof VisitCopyConflict
      ? JSON.stringify({ error: error.message, conflicts: error.conflicts })
      : 'Visit copy failed; verify credentials, target confirmation, schema and connectivity. No conflicting rows are overwritten.',
  );
  process.exitCode = 1;
});
