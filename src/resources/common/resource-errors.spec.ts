import {
  assertAllFound,
  assertMatchingId,
  assertVersion,
} from './resource-errors';
import { Repository } from 'typeorm';
import { HotelEntity } from '../hotels/hotel.entity';
import { ensureCodeAvailable } from './resource-service.helpers';

describe('resource errors', () => {
  it('reports all missing ids before a batch mutation starts', () => {
    expect(
      captureError(() =>
        assertAllFound(['one', 'two'], ['one'], 'HOTEL_NOT_FOUND'),
      ),
    ).toMatchObject({
      code: 'HOTEL_NOT_FOUND',
      details: { missingIds: ['two'] },
    });
  });

  it('rejects body and path id mismatches', () => {
    expect(captureError(() => assertMatchingId('one', 'two'))).toMatchObject({
      code: 'RESOURCE_ID_MISMATCH',
    });
  });

  it('rejects stale versions', () => {
    expect(captureError(() => assertVersion(3, 2))).toMatchObject({
      code: 'RESOURCE_VERSION_CONFLICT',
    });
  });

  it('keeps resource codes reserved after soft deletion', async () => {
    const findOne = jest
      .fn()
      .mockResolvedValue({ id: 'deleted', code: 'HTL001' });
    const repository = {
      findOne,
    } as unknown as Repository<HotelEntity>;
    await expect(
      ensureCodeAvailable(repository, 'HTL001'),
    ).rejects.toMatchObject({ code: 'RESOURCE_CODE_EXISTS' });
    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({ withDeleted: true }),
    );
  });
});

function captureError(callback: () => void): unknown {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error('Expected callback to throw');
}
