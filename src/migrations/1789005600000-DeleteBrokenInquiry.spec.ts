import { QueryRunner } from 'typeorm';
import { DeleteBrokenInquiry1789005600000 } from './1789005600000-DeleteBrokenInquiry';

describe('DeleteBrokenInquiry1789005600000', () => {
  it('hard-deletes only the confirmed inquiry and its dependent records', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ code: 'INQ-20260909-01' }])
      .mockResolvedValue([]);
    const migration = new DeleteBrokenInquiry1789005600000();

    await migration.up({ query } as unknown as QueryRunner);

    expect(query.mock.calls).toEqual([
      [
        'SELECT code FROM inquiries WHERE id=$1',
        ['50e17cbe-36fe-41b3-b3cb-af6157f9d97a'],
      ],
      [
        'DELETE FROM itinerary_quotes WHERE itinerary_id IN (SELECT id FROM itineraries WHERE inquiry_id=$1)',
        ['50e17cbe-36fe-41b3-b3cb-af6157f9d97a'],
      ],
      [
        'DELETE FROM inquiry_logs WHERE inquiry_id=$1',
        ['50e17cbe-36fe-41b3-b3cb-af6157f9d97a'],
      ],
      [
        'DELETE FROM itineraries WHERE inquiry_id=$1',
        ['50e17cbe-36fe-41b3-b3cb-af6157f9d97a'],
      ],
      [
        'DELETE FROM inquiries WHERE id=$1',
        ['50e17cbe-36fe-41b3-b3cb-af6157f9d97a'],
      ],
    ]);
  });

  it('refuses to delete a record whose code does not match', async () => {
    const query = jest.fn().mockResolvedValue([{ code: 'INQ-OTHER' }]);
    const migration = new DeleteBrokenInquiry1789005600000();

    await expect(
      migration.up({ query } as unknown as QueryRunner),
    ).rejects.toThrow('Hard-delete target does not match');
    expect(query).toHaveBeenCalledTimes(1);
  });
});
