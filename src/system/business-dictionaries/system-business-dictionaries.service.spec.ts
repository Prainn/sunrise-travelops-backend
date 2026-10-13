import { HttpStatus } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-code';
import { BusinessDictionaryItemEntity } from './business-dictionary-item.entity';
import { BusinessDictionaryTypeEntity } from './business-dictionary-type.entity';
import { SystemBusinessDictionariesService } from './system-business-dictionaries.service';
import { BusinessDictionaryStatus } from './business-dictionary-status';

describe('built-in business category', () => {
  const province = Object.assign(new BusinessDictionaryTypeEntity(), {
    id: 'province-id',
    code: 'province',
    name: '省份',
    englishName: 'Province',
    builtIn: true,
    items: [],
  });
  const transaction = jest.fn();
  const save = jest.fn((entity: BusinessDictionaryTypeEntity) =>
    Promise.resolve(entity),
  );
  const dictionaryTypes = {
    create: jest.fn((input: Partial<BusinessDictionaryTypeEntity>) =>
      Object.assign(new BusinessDictionaryTypeEntity(), input),
    ),
    save,
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([province]),
    findBy: jest.fn().mockResolvedValue([province]),
    findOneBy: jest.fn().mockResolvedValue(province),
  } as unknown as Repository<BusinessDictionaryTypeEntity>;
  const service = new SystemBusinessDictionariesService(
    dictionaryTypes,
    {} as Repository<BusinessDictionaryItemEntity>,
    { transaction } as unknown as DataSource,
  );

  beforeEach(() => transaction.mockClear());

  it('persists the selected built-in flag when creating a category', async () => {
    await expect(
      service.createDictionaryType(
        {
          code: 'custom',
          name: '自定义',
          englishName: 'Custom',
          builtIn: true,
        },
        'actor-id',
      ),
    ).resolves.toMatchObject({ builtIn: true });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ builtIn: true }),
    );
  });

  it('reports the stored built-in flag', async () => {
    await expect(service.getDictionaryTypes()).resolves.toMatchObject([
      { builtIn: true },
    ]);
  });

  it('rejects deleting a built-in category before any write', async () => {
    await expect(
      service.deleteDictionaryTypes([province.id], 'actor-id'),
    ).rejects.toMatchObject({
      code: ErrorCode.BUILT_IN_BUSINESS_DICTIONARY_CANNOT_BE_DELETED,
      status: HttpStatus.CONFLICT,
    });
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('referenced attraction price item types', () => {
  const type = {
    id: 'type-id',
    code: 'attraction-price-item-type',
    builtIn: true,
  };
  const item = {
    id: 'item-id',
    code: 'ticket',
    englishName: 'Admission',
    typeId: type.id,
  };
  const save = jest
    .fn()
    .mockImplementation((value: unknown) => Promise.resolve(value));
  const query = jest.fn().mockResolvedValue([{ id: item.id }]);
  const transaction = jest.fn();
  const service = new SystemBusinessDictionariesService(
    {
      findOneBy: jest.fn().mockResolvedValue(type),
    } as unknown as Repository<BusinessDictionaryTypeEntity>,
    {
      findOne: jest.fn().mockResolvedValue(null),
      findOneBy: jest.fn().mockImplementation(() => ({ ...item })),
      findBy: jest.fn().mockResolvedValue([item]),
      save,
    } as unknown as Repository<BusinessDictionaryItemEntity>,
    { query, transaction } as unknown as DataSource,
  );
  const input = {
    code: 'ticket',
    name: '入园票',
    englishName: 'Entry Ticket',
    resourceTypes: [],
    status: BusinessDictionaryStatus.Enabled,
    remark: '',
  };

  it('rejects changing a referenced code before saving', async () => {
    await expect(
      service.updateDictionaryItem(
        type.code,
        item.id,
        { ...input, code: 'new-code' },
        'actor-id',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    expect(save).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('resource_attraction_prices'),
      [[item.id]],
    );
  });

  it('allows bilingual label maintenance without changing the code', async () => {
    await expect(
      service.updateDictionaryItem(type.code, item.id, input, 'actor-id'),
    ).resolves.toMatchObject({ name: '入园票', englishName: 'Entry Ticket' });
  });

  it('rejects deleting a referenced item before any write transaction', async () => {
    await expect(
      service.deleteDictionaryItems(type.code, [item.id], 'actor-id'),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    expect(transaction).not.toHaveBeenCalled();
  });
});
