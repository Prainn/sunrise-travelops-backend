import { EntityManager } from 'typeorm';
import { coordinator } from './ledger-access';

// Local query mocks only; no database connection or environment configuration.
describe('ledger coordinator eligibility', () => {
  function setup(rows: Array<{ id: string; name: string }>) {
    const query = jest.fn().mockResolvedValue(rows);
    return { query, manager: { query } as unknown as EntityManager };
  }

  it('authorizes Shengxu by enabled coordinator role without a duty restriction', async () => {
    const row = { id: 'coordinator', name: 'Test' };
    const { manager, query } = setup([row]);
    await expect(coordinator(manager, row.id, 'shengxu')).resolves.toEqual(row);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual(['shengxu', row.id]);
    expect(sql).not.toContain('coordinator_duty');
    for (const clause of [
      'i.scope=$1',
      "u.status='enabled'",
      'u.deleted_at IS NULL',
      'NOT u.is_superuser',
      "r.code='COORDINATOR' AND r.is_enabled",
      'u.id=$2',
    ])
      expect(sql).toContain(clause);
  });

  it.each(['linxi', 'website'])(
    'retains reception and operation duty restrictions for %s',
    async (unit) => {
      const { manager, query } = setup([{ id: 'coordinator', name: 'Test' }]);
      for (const duty of ['reception', 'operation'] as const) {
        await coordinator(manager, 'coordinator', unit, duty);
        expect(query).toHaveBeenLastCalledWith(
          expect.stringContaining("i.coordinator_duty IN ($3,'both')"),
          [unit, 'coordinator', duty],
        );
      }
    },
  );

  it('rejects an ineligible Shengxu account', async () => {
    const { manager } = setup([]);
    await expect(
      coordinator(manager, 'disabled', 'shengxu'),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      response: { message: '请选择本业务启用的计调' },
    });
  });
});
