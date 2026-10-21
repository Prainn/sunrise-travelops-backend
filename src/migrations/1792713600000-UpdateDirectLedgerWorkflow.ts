import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateDirectLedgerWorkflow1792713600000 implements MigrationInterface {
  name = 'UpdateDirectLedgerWorkflow1792713600000';

  async up(q: QueryRunner): Promise<void> {
    // CreateManualLedgers 的第四个表级 CHECK 将操作与成团状态耦合；
    // 新流程只要求亏损确认，保留其余约束和历史审核/操作事实。
    await q.query(
      'ALTER TABLE direct_ledgers DROP CONSTRAINT direct_ledgers_check3',
    );
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Operated entries may remain unconverted; retain records and review a recovery plan before restoring the old workflow',
      ),
    );
  }
}
