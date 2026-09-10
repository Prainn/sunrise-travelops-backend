import { MigrationInterface, QueryRunner } from 'typeorm';

const INQUIRY_ID = '50e17cbe-36fe-41b3-b3cb-af6157f9d97a';
const INQUIRY_CODE = 'INQ-20260909-01';

export class DeleteBrokenInquiry1789005600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    const inquiries = (await queryRunner.query(
      'SELECT code FROM inquiries WHERE id=$1',
      [INQUIRY_ID],
    )) as Array<{ code: string }>;
    if (!inquiries.length) return;
    if (inquiries.length !== 1 || inquiries[0].code !== INQUIRY_CODE)
      throw new Error(
        'Hard-delete target does not match the confirmed inquiry',
      );

    await queryRunner.query(
      'DELETE FROM itinerary_quotes WHERE itinerary_id IN (SELECT id FROM itineraries WHERE inquiry_id=$1)',
      [INQUIRY_ID],
    );
    await queryRunner.query('DELETE FROM inquiry_logs WHERE inquiry_id=$1', [
      INQUIRY_ID,
    ]);
    await queryRunner.query('DELETE FROM itineraries WHERE inquiry_id=$1', [
      INQUIRY_ID,
    ]);
    await queryRunner.query('DELETE FROM inquiries WHERE id=$1', [INQUIRY_ID]);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error('The hard-deleted inquiry can only be restored from backup'),
    );
  }
}
