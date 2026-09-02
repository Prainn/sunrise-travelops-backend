import { DataSource, Repository } from 'typeorm';
import { DictionaryItemEntity } from './dictionary-item.entity';
import { DictionaryStatus } from './dictionary-status';
import { DictionaryTypeEntity } from './dictionary-type.entity';
import { DictionaryTypeInputDto } from './dto/dictionary.dto';
import { SystemDictionariesService } from './system-dictionaries.service';

function createQueryBuilder(getExists: boolean) {
  const builder = {
    withDeleted: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    getExists: jest.fn().mockResolvedValue(getExists),
  };
  builder.withDeleted.mockReturnValue(builder);
  builder.where.mockReturnValue(builder);
  builder.andWhere.mockReturnValue(builder);
  return builder;
}

describe('SystemDictionariesService', () => {
  let dictionaryTypes: jest.Mocked<Repository<DictionaryTypeEntity>>;
  let dictionaryItems: jest.Mocked<Repository<DictionaryItemEntity>>;
  let dataSource: jest.Mocked<DataSource>;
  let service: SystemDictionariesService;

  beforeEach(() => {
    dictionaryTypes = {
      create: jest.fn(),
      createQueryBuilder: jest.fn(),
      findOneBy: jest.fn(),
      save: jest.fn(),
    } as unknown as jest.Mocked<Repository<DictionaryTypeEntity>>;
    dictionaryItems = {
      create: jest.fn(),
      createQueryBuilder: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
    } as unknown as jest.Mocked<Repository<DictionaryItemEntity>>;
    dataSource = {
      transaction: jest.fn(),
    } as unknown as jest.Mocked<DataSource>;
    service = new SystemDictionariesService(
      dictionaryTypes,
      dictionaryItems,
      dataSource,
    );
  });

  it('rejects a dictionary code that already exists', async () => {
    dictionaryTypes.createQueryBuilder.mockReturnValue(
      createQueryBuilder(true) as never,
    );

    await expect(
      service.createDictionaryType(
        {
          name: '重复分类',
          dictCode: 'gender',
          status: DictionaryStatus.Enabled,
        },
        '00000000-0000-4000-8000-000000000999',
      ),
    ).rejects.toMatchObject({
      code: 'DICTIONARY_CODE_EXISTS',
    });
  });

  it('records the creating user when a dictionary type is created', async () => {
    const actorId = '00000000-0000-4000-8000-000000000999';
    const input: DictionaryTypeInputDto = {
      name: '来源渠道',
      dictCode: 'inquiry_source',
      status: DictionaryStatus.Enabled,
      remark: '询盘来源',
    };
    const entity = {
      id: '00000000-0000-4000-8000-000000000010',
      ...input,
      remark: input.remark ?? null,
      createdBy: actorId,
      updatedBy: actorId,
    } as DictionaryTypeEntity;
    dictionaryTypes.createQueryBuilder.mockReturnValue(
      createQueryBuilder(false) as never,
    );
    dictionaryTypes.create.mockReturnValue(entity);
    dictionaryTypes.save.mockResolvedValue(entity);

    await expect(service.createDictionaryType(input, actorId)).resolves.toEqual(
      {
        id: entity.id,
        name: input.name,
        dictCode: input.dictCode,
        status: DictionaryStatus.Enabled,
        remark: input.remark,
      },
    );
    expect(dictionaryTypes.create.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ createdBy: actorId, updatedBy: actorId }),
    );
  });

  it('renames a dictionary type without rewriting its item records', async () => {
    const actorId = '00000000-0000-4000-8000-000000000999';
    const entity = {
      id: '00000000-0000-4000-8000-000000000001',
      name: '用户性别',
      dictCode: 'gender',
      status: DictionaryStatus.Enabled,
      remark: null,
    } as DictionaryTypeEntity;
    dictionaryTypes.findOneBy.mockResolvedValue(entity);
    dictionaryTypes.createQueryBuilder.mockReturnValue(
      createQueryBuilder(false) as never,
    );
    dictionaryTypes.save.mockResolvedValue(entity);

    await service.updateDictionaryType(
      entity.id,
      {
        id: entity.id,
        name: '性别',
        dictCode: 'user_gender',
        status: DictionaryStatus.Enabled,
      },
      actorId,
    );

    expect(dictionaryTypes.save.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        dictCode: 'user_gender',
        updatedBy: actorId,
      }),
    );
    expect(dictionaryItems.save.mock.calls).toHaveLength(0);
  });
});
