import { MigrationInterface, QueryRunner } from 'typeorm';
import { insertMailQuotes, splitMailBody } from './support/mail-quoted-body-v1';

export class StoreMailQuotedHistory1796256025000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE mail_messages ADD COLUMN authored_body text;
      CREATE TABLE mail_message_quotes (
        message_id uuid NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
        position integer NOT NULL CHECK (position > 0),
        sender text NOT NULL, sent_at_text text NOT NULL, recipient_text text, cc_text text,
        subject text, body text NOT NULL, PRIMARY KEY (message_id, position)
      );
    `);
    let after: string | null = null;
    for (;;) {
      const rows = (await runner.query(
        `SELECT id, body FROM mail_messages WHERE body <> '' AND ($1::uuid IS NULL OR id > $1)
         ORDER BY id LIMIT 50`,
        [after],
      )) as { id: string; body: string }[];
      if (!rows.length) break;
      for (const row of rows) {
        const { authoredBody, quotes } = splitMailBody(row.body);
        if (!quotes.length) continue;
        await runner.query(
          'UPDATE mail_messages SET authored_body=$2 WHERE id=$1',
          [row.id, authoredBody],
        );
        await insertMailQuotes(runner.manager, row.id, quotes);
      }
      after = rows[rows.length - 1].id;
    }
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      'DROP TABLE mail_message_quotes; ALTER TABLE mail_messages DROP COLUMN authored_body',
    );
  }
}
