import { QueryRunner } from 'typeorm';
import { DropSuppliers1789092000000 } from '../../src/migrations/1789092000000-DropSuppliers';

describe('DropSuppliers1789092000000', () => {
  it('deletes supplier permissions and drops the supplier table', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const migration = new DropSuppliers1789092000000();

    await migration.up({ query } as unknown as QueryRunner);

    expect(query.mock.calls).toEqual([
      [`DELETE FROM "permissions" WHERE "code" LIKE 'resource:supplier:%'`],
      [`DROP TABLE "resource_suppliers"`],
    ]);
  });

  it('cannot restore deleted supplier data', async () => {
    const migration = new DropSuppliers1789092000000();

    await expect(migration.down()).rejects.toThrow(
      'Deleted supplier data cannot be restored',
    );
  });
});
