import { MigrationInterface, QueryRunner } from 'typeorm';

export class UseAttractionPriceItemDictionary1791792000000 implements MigrationInterface {
  name = 'UseAttractionPriceItemDictionary1791792000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO system_business_dictionary_types (code,name,english_name,is_built_in)
      VALUES ('attraction-price-item-type','景点票价项目类型','Attraction Price Item Types',true)
      ON CONFLICT (code) DO UPDATE SET is_built_in=true
      WHERE system_business_dictionary_types.deleted_at IS NULL
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM system_business_dictionary_types
          WHERE code='attraction-price-item-type' AND deleted_at IS NULL) THEN
          RAISE EXCEPTION 'Attraction price item type category is deleted';
        END IF;
      END $$
    `);
    await queryRunner.query(`
      INSERT INTO system_business_dictionary_items (type_id,code,name,english_name,status)
      SELECT type.id, seed.code, seed.name, seed.english_name, 'enabled'
      FROM system_business_dictionary_types type
      CROSS JOIN (VALUES
        ('ticket','门票','Admission'),
        ('transport','区间交通','Local Transport'),
        ('guide','讲解服务','Guide Service'),
        ('activity','特色活动','Activity'),
        ('package','套票','Package')
      ) AS seed(code,name,english_name)
      WHERE type.code='attraction-price-item-type' AND type.deleted_at IS NULL
      ON CONFLICT (type_id,code) DO NOTHING
    `);
    await queryRunner.query(`
      ALTER TABLE resource_attraction_prices
      DROP CONSTRAINT IF EXISTS "CHK_resource_attraction_prices_item_type"
    `);
    await queryRunner.query(`
      ALTER TABLE resource_attraction_prices ALTER COLUMN item_type TYPE varchar(100)
    `);
    await queryRunner.query(`
      ALTER TABLE resource_attraction_prices
      ADD CONSTRAINT "CHK_resource_attraction_prices_item_type"
      CHECK (item_type ~ '^[a-z][a-zA-Z0-9-]*$')
    `);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Custom item types must be reviewed before restoring the fixed enum',
      ),
    );
  }
}
