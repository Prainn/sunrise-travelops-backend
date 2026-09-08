import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource } from 'typeorm';
import { PERMISSIONS_KEY } from '../../auth/decorators/permissions.decorator';
import { SelectionController } from './selection.controller';
import { SelectionQuery } from './selection.dto';
import { SelectionService } from './selection.service';

describe('resource selections', () => {
  it('defaults to 10 and rejects invalid or unbounded pages', async () => {
    const defaults = plainToInstance(SelectionQuery, {});
    expect(defaults.pageSize).toBe(10);
    expect(await validate(defaults)).toHaveLength(0);
    for (const query of [
      { pageSize: 100 },
      { page: 0 },
      { pageSize: 'invalid' },
      { guestCount: -1 },
    ]) {
      expect(
        (await validate(plainToInstance(SelectionQuery, query))).length,
      ).toBeGreaterThan(0);
    }
  });
  it.each([
    ['restaurants', 'restaurant'],
    ['restaurant', 'restaurant'],
    ['attractions', 'attraction'],
    ['attraction', 'attraction'],
    ['hotels', 'hotel'],
    ['transports', 'transport'],
    ['guides', 'guide'],
    ['agencies', 'agency'],
  ] as const)('retains resource permissions for %s', (method, permission) => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        Object.getOwnPropertyDescriptor(SelectionController.prototype, method)!
          .value as object,
      ),
    ).toEqual([`resource:${permission}:list`]);
  });
  it('pages a joined price query instead of fetching each resource', async () => {
    const qb = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(42),
      getRawMany: jest
        .fn()
        .mockResolvedValue([{ id: 'one', unitCost: '0.00' }]),
      getOne: jest.fn().mockResolvedValue(null),
    };
    const source = {
      getRepository: jest
        .fn()
        .mockReturnValue({ createQueryBuilder: () => qb }),
    };
    const service = new SelectionService(source as unknown as DataSource);
    const result = await service.list(
      'attraction',
      Object.assign(new SelectionQuery(), { page: 2, city: '大理' }),
    );
    expect(result.total).toBe(42);
    expect(result.list[0].unitCost).toBe('0.00');
    expect(qb.limit).toHaveBeenCalledWith(10);
    expect(qb.offset).toHaveBeenCalledWith(10);
    expect(qb.where).toHaveBeenCalledWith('resource.status = :status', {
      status: 'enabled',
    });
    expect(qb.andWhere).toHaveBeenCalledWith('resource.deletedAt IS NULL');
    expect(qb.andWhere).toHaveBeenCalledWith('resource.area = :city', {
      city: '大理',
    });
    expect(qb.getCount).toHaveBeenCalledTimes(1);
    expect(qb.getRawMany).toHaveBeenCalledTimes(1);
    expect(qb.getOne).not.toHaveBeenCalled();
    await expect(service.detail('attraction', 'missing')).rejects.toMatchObject(
      { code: 'ATTRACTION_PRICE_NOT_FOUND' },
    );
    expect(qb.getOne).toHaveBeenCalledTimes(1);
  });
});
