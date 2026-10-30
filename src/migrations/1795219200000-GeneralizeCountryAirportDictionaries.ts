import { MigrationInterface, QueryRunner } from 'typeorm';

export class GeneralizeCountryAirportDictionaries1795219200000 implements MigrationInterface {
  name = 'GeneralizeCountryAirportDictionaries1795219200000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE inquiries ALTER COLUMN country_code TYPE varchar(100);
      ALTER TABLE website_inquiries ALTER COLUMN country_code TYPE varchar(100);
      ALTER TABLE tours ALTER COLUMN country_code TYPE varchar(100),
        ALTER COLUMN tour_no TYPE varchar(160)`);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Custom country codes and tour numbers may exceed the old limits; retain widened columns during application rollback',
      ),
    );
  }
}
