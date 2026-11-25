import { HttpStatus } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DataSource, Repository } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-code';
import { BusinessDictionaryItemEntity } from './business-dictionary-item.entity';
import { BusinessDictionaryTypeEntity } from './business-dictionary-type.entity';
import { SystemBusinessDictionariesService } from './system-business-dictionaries.service';
import { BusinessDictionaryItemInputDto } from './dto/business-dictionary.dto';

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

  it('accepts canonical seat codes only for the vehicle dictionary and saves the same code for legacy input', async () => {
    const input = plainToInstance(BusinessDictionaryItemInputDto, {
      code: '38_seat',
      name: '38座',
      englishName: '38-seat vehicle',
    });
    expect(validateSync(input)).toHaveLength(0);
    const items = {
      findOne: jest.fn().mockResolvedValue(null),
      create: (row: Partial<BusinessDictionaryItemEntity>) => row,
      save: (row: BusinessDictionaryItemEntity) => Promise.resolve(row),
    } as unknown as Repository<BusinessDictionaryItemEntity>;
    const catalog = new SystemBusinessDictionariesService(
      dictionaryTypes,
      items,
      {} as DataSource,
    );
    for (const code of ['38_seat', 'seat38'])
      await expect(
        catalog.createDictionaryItem(
          'vehicle-type',
          { ...input, code },
          'actor-id',
        ),
      ).resolves.toMatchObject({ code: '38_seat' });
    await expect(
      catalog.createDictionaryItem('guide-language', input, 'actor-id'),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
    await expect(
      catalog.createDictionaryItem(
        'vehicle-type',
        { ...input, code: '0_seat' },
        'actor-id',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
  });

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
