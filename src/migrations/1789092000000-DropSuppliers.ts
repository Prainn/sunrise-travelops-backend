import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropSuppliers1789092000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "permissions" WHERE "code" LIKE 'resource:supplier:%'`,
    );
    await queryRunner.query(`DROP TABLE "resource_suppliers"`);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error('Deleted supplier data cannot be restored'),
    );
  }
}
