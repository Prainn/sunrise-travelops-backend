import { MigrationInterface, QueryRunner } from 'typeorm';

export class SimplifyDepartmentNames1789459300000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE departments SET name = CASE
        WHEN id IN (2, 6, 8) THEN '资源管理部'
        WHEN id IN (3, 5, 7) THEN '计调部'
      END
      WHERE (id IN (2, 3) AND scope = 'shengxu')
         OR (id IN (5, 6) AND scope = 'linxi')
         OR (id IN (7, 8) AND scope = 'website')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE departments SET name =
        CASE scope WHEN 'shengxu' THEN '盛旭 · '
          WHEN 'linxi' THEN '霖熹 · ' WHEN 'website' THEN '独立站 · ' END
        || CASE WHEN id IN (2, 6, 8) THEN '资源管理部' ELSE '计调部' END
      WHERE (id IN (2, 3) AND scope = 'shengxu')
         OR (id IN (5, 6) AND scope = 'linxi')
         OR (id IN (7, 8) AND scope = 'website')
    `);
  }
}
