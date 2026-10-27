import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInquirySoftDelete1794355200000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE inquiries ADD COLUMN deleted_at timestamptz;
      ALTER TABLE website_inquiries ADD COLUMN deleted_at timestamptz;
      INSERT INTO permissions(code,name) VALUES
        ('inquiry:delete','删除询盘'),('website:inquiry:delete','删除独立站询盘')
        ON CONFLICT(code) DO NOTHING;
    `);
  }
  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Retain inquiry deletion markers; application rollback requires a version that still filters deleted_at',
      ),
    );
  }
}
