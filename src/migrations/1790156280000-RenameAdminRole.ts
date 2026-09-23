import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameAdminRole1790156280000 implements MigrationInterface {
  name = 'RenameAdminRole1790156280000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "roles" SET "name" = '系统管理员' WHERE "code" = 'ADMIN' AND "name" IS DISTINCT FROM '系统管理员'`,
    );
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error('Cannot restore the incorrect ADMIN role name'),
    );
  }
}
