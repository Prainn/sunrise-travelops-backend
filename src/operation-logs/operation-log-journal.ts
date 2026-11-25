import { randomUUID } from 'node:crypto';
import { mkdir, open, opendir, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { OperationEntry } from './operation-logs.service';

export type StoredOperation = OperationEntry & { id: string; time: Date };
export class OperationLogJournal {
  constructor(private readonly dir: string) {}

  async save(rows: StoredOperation[]) {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const name = join(this.dir, randomUUID());
    const temporary = name + '.tmp';
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(JSON.stringify(rows));
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, name + '.json');
    const directory = await open(this.dir, 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }

  async replay(insert: (rows: StoredOperation[]) => Promise<void>) {
    const directory = await opendir(this.dir).catch(
      (e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT') return undefined;
        throw e;
      },
    );
    if (!directory) return;
    let processed = 0;
    for await (const entry of directory) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const file = join(this.dir, entry.name);
      const raw = await readFile(file, 'utf8').catch(
        (e: NodeJS.ErrnoException) => {
          if (e.code === 'ENOENT') return undefined;
          throw e;
        },
      );
      if (!raw) continue;
      const rows = JSON.parse(raw) as StoredOperation[];
      await insert(rows.map((row) => ({ ...row, time: new Date(row.time) })));
      await rm(file, { force: true });
      if (++processed >= 100) break;
    }
  }
}
