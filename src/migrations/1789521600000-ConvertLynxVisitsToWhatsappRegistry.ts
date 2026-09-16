import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConvertLynxVisitsToWhatsappRegistry1789521600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('TRUNCATE TABLE "lynx_visits"');
    await queryRunner.query('ALTER TABLE "lynx_visits" DROP COLUMN "ip"');
    await queryRunner.query('ALTER TABLE "lynx_visits" DROP COLUMN "browser"');
    await queryRunner.query(
      'ALTER TABLE "lynx_visits" RENAME COLUMN "created_at" TO "created_at_utc"',
    );
    await queryRunner.query(`
      ALTER TABLE "lynx_visits"
        ADD COLUMN "website_inquiry_id" varchar(128) NOT NULL,
        ADD COLUMN "contract_version" varchar(16) NOT NULL,
        ADD COLUMN "first_landing_page" text,
        ADD COLUMN "external_referrer" text,
        ADD COLUMN "utm_source" text,
        ADD COLUMN "utm_medium" text,
        ADD COLUMN "utm_campaign" text,
        ADD COLUMN "utm_term" text,
        ADD COLUMN "utm_content" text,
        ADD COLUMN "gclid" text,
        ADD COLUMN "gbraid" text,
        ADD COLUMN "wbraid" text,
        ADD COLUMN "expires_at_utc" timestamptz NOT NULL,
        ADD COLUMN "payload_fingerprint" char(64) NOT NULL,
        ADD CONSTRAINT "UQ_lynx_visits_whatsapp_reference" UNIQUE ("whatsapp_reference"),
        ADD CONSTRAINT "CHK_lynx_visits_expiry" CHECK ("expires_at_utc" = "created_at_utc" + interval '4320 hours')
    `);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'WhatsApp registry conversion is irreversible; restore the pre-upgrade database backup instead',
      ),
    );
  }
}
