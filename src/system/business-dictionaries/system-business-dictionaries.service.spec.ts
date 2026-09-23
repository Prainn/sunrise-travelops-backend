import { HttpStatus } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-code';
import { BusinessDictionaryItemEntity } from './business-dictionary-item.entity';
import { BusinessDictionaryTypeEntity } from './business-dictionary-type.entity';
import { SystemBusinessDictionariesService } from './system-business-dictionaries.service';

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
