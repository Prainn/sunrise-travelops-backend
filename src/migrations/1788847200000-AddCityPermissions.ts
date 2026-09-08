import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCityPermissions1788847200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`INSERT INTO "permissions" ("code", "name")
      SELECT code, code FROM (VALUES ('resource:city:list'), ('resource:city:create'),
        ('resource:city:update'), ('resource:city:delete')) AS city_permissions(code)
      ON CONFLICT ("code") DO NOTHING`);
    await queryRunner.query(`INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
      WHERE r.code IN ('ROOT', 'ADMIN', 'RESOURCE_MANAGER')
        AND p.code IN ('resource:city:list', 'resource:city:create', 'resource:city:update', 'resource:city:delete')
      ON CONFLICT DO NOTHING`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM role_permissions WHERE permission_id IN
      (SELECT id FROM permissions WHERE code IN ('resource:city:list', 'resource:city:create', 'resource:city:update', 'resource:city:delete'))`);
    await queryRunner.query(`DELETE FROM permissions WHERE code IN
      ('resource:city:list', 'resource:city:create', 'resource:city:update', 'resource:city:delete')`);
  }
}
