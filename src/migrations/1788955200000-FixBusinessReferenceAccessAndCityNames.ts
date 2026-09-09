import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixBusinessReferenceAccessAndCityNames1788955200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
      WHERE r.code IN ('RESOURCE_MANAGER', 'COORDINATOR')
        AND p.code = 'sys:business-dictionary:list'
      ON CONFLICT DO NOTHING`);
    await queryRunner.query(`ALTER TABLE resource_cities
      DROP CONSTRAINT "UQ_resource_cities_name"`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_resource_cities_name"
      ON resource_cities (name) WHERE deleted_at IS NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_resource_cities_name"`);
    await queryRunner.query(`ALTER TABLE resource_cities
      ADD CONSTRAINT "UQ_resource_cities_name" UNIQUE (name)`);
    await queryRunner.query(`DELETE FROM role_permissions
      WHERE role_id IN (SELECT id FROM roles WHERE code IN ('RESOURCE_MANAGER', 'COORDINATOR'))
        AND permission_id IN (SELECT id FROM permissions WHERE code = 'sys:business-dictionary:list')`);
  }
}
