import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgencyHierarchy1791365557000 implements MigrationInterface {
  name = 'AddAgencyHierarchy1791365557000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "resource_agencies" ADD "parent_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource_agencies" ADD CONSTRAINT "FK_resource_agencies_parent" FOREIGN KEY ("parent_id") REFERENCES "resource_agencies"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource_agencies" ADD CONSTRAINT "CHK_resource_agencies_parent" CHECK ("parent_id" IS NULL OR "parent_id" <> "id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_resource_agencies_parent" ON "resource_agencies" ("parent_id") WHERE "deleted_at" IS NULL`,
    );
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Agency hierarchy data must be retained when rolling back the application',
      ),
    );
  }
}
