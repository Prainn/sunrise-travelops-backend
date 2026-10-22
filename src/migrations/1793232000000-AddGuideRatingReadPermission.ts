import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGuideRatingReadPermission1793232000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO permissions (code, name) VALUES ('tour:rating:list', '查看导游评分')
       ON CONFLICT (code) DO NOTHING`,
    );
    await queryRunner.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
       WHERE r.code IN ('ROOT', 'ADMIN', 'EXECUTIVE', 'BUSINESS_MANAGER', 'COORDINATOR')
         AND p.code = 'tour:rating:list' ON CONFLICT DO NOTHING`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM role_permissions WHERE permission_id IN
       (SELECT id FROM permissions WHERE code = 'tour:rating:list')`,
    );
    await queryRunner.query(
      `DELETE FROM permissions WHERE code = 'tour:rating:list'`,
    );
  }
}
