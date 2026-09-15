import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReleaseDeletedUsernames1789459400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM user_identities AS identity
      USING users AS account
      WHERE identity.user_id = account.id AND account.deleted_at IS NOT NULL`);
  }

  down(): Promise<void> {
    throw new Error(
      'Deleted identities cannot be restored after usernames are reused',
    );
  }
}
