import { DataSource, Repository } from 'typeorm';
import { BusinessDictionaryItemEntity } from './business-dictionary-item.entity';
import { BusinessDictionaryStatus } from './business-dictionary-status';
import { BusinessDictionaryTypeEntity } from './business-dictionary-type.entity';
import { SystemBusinessDictionariesService } from './system-business-dictionaries.service';

describe('SystemBusinessDictionariesService', () => {
  let dictionaryTypes: jest.Mocked<Repository<BusinessDictionaryTypeEntity>>;
  let dictionaryItems: jest.Mocked<Repository<BusinessDictionaryItemEntity>>;
  let dataSource: jest.Mocked<DataSource>;
  let service: SystemBusinessDictionariesService;

  beforeEach(() => {
    dictionaryTypes = {
      findOne: jest.fn(),
      findOneBy: jest.fn(),
    } as unknown as jest.Mocked<Repository<BusinessDictionaryTypeEntity>>;
    dictionaryItems = {
      create: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
    } as unknown as jest.Mocked<Repository<BusinessDictionaryItemEntity>>;
    dataSource = {
      transaction: jest.fn(),
    } as unknown as jest.Mocked<DataSource>;
    service = new SystemBusinessDictionariesService(
      dictionaryTypes,
      dictionaryItems,
      dataSource,
    );
  });

  it('requires applicable resource types for resource-unit items', async () => {
    dictionaryTypes.findOneBy.mockResolvedValue({
      id: '10000000-0000-4000-8000-000000000001',
      code: 'resource-unit',
    } as BusinessDictionaryTypeEntity);

    await expect(
      service.createDictionaryItem(
        'resource-unit',
        {
          code: 'newUnit',
          name: '新单位',
          englishName: 'New unit',
          resourceTypes: [],
          status: BusinessDictionaryStatus.Enabled,
          remark: '',
        },
        '00000000-0000-4000-8000-000000000999',
      ),
    ).rejects.toMatchObject({
      code: 'BUSINESS_DICTIONARY_RESOURCE_TYPES_REQUIRED',
    });
  });

  it('does not allow built-in dictionary types to be deleted', async () => {
    const id = '10000000-0000-4000-8000-000000000001';
    dictionaryTypes.findBy = jest.fn().mockResolvedValue([
      {
        id,
        builtIn: true,
      } as BusinessDictionaryTypeEntity,
    ]);

    await expect(
      service.deleteDictionaryTypes(
        [id],
        '00000000-0000-4000-8000-000000000999',
      ),
    ).rejects.toMatchObject({
      code: 'BUILT_IN_BUSINESS_DICTIONARY_CANNOT_BE_DELETED',
    });
    expect(dataSource.transaction.mock.calls).toHaveLength(0);
  });
});
