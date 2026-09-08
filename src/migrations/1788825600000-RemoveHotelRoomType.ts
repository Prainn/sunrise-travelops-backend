import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveHotelRoomType1788825600000 implements MigrationInterface {
  name = 'RemoveHotelRoomType1788825600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "resource_hotels" DROP COLUMN "basic_room_type"',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "resource_hotels" ADD COLUMN "basic_room_type" varchar(100) NOT NULL DEFAULT \'\'',
    );
  }
}
