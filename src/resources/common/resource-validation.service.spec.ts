import { CityEntity } from '../cities/city.entity';
import { Repository } from 'typeorm';
import { BusinessDictionaryItemEntity } from '../../system/business-dictionaries/business-dictionary-item.entity';
import { BusinessDictionaryTypeEntity } from '../../system/business-dictionaries/business-dictionary-type.entity';
import { ResourceStatus } from './resource.constants';
import { ResourceValidationService } from './resource-validation.service';

describe('ResourceValidationService', () => {
  let types: jest.Mocked<Repository<BusinessDictionaryTypeEntity>>;
  let items: jest.Mocked<Repository<BusinessDictionaryItemEntity>>;
  let cities: jest.Mocked<Repository<CityEntity>>;
  let service: ResourceValidationService;

  beforeEach(() => {
    types = { findOneBy: jest.fn() } as unknown as jest.Mocked<
      Repository<BusinessDictionaryTypeEntity>
    >;
    items = { findOneBy: jest.fn() } as unknown as jest.Mocked<
      Repository<BusinessDictionaryItemEntity>
    >;
    cities = { findOneBy: jest.fn() } as unknown as jest.Mocked<
      Repository<CityEntity>
    >;
    service = new ResourceValidationService(types, items, cities);
  });

  it('requires an enabled city for new selections and permits unchanged history', async () => {
    cities.findOneBy.mockResolvedValue(null);
    await expect(service.validateCity('Unknown')).rejects.toMatchObject({
      code: 'RESOURCE_CITY_INVALID',
      details: { city: 'Unknown' },
    });
    cities.findOneBy.mockClear();
    await expect(
      service.validateCity('Retired city', 'Retired city'),
    ).resolves.toBeUndefined();
    await expect(service.validateCity('')).resolves.toBeUndefined();
    expect(cities.findOneBy.mock.calls).toHaveLength(0);
    cities.findOneBy.mockResolvedValue({ name: '昆明' } as CityEntity);
    await expect(service.validateCity('昆明')).resolves.toBeUndefined();
    expect(cities.findOneBy.mock.calls[0]).toEqual([
      {
        name: '昆明',
        status: ResourceStatus.Enabled,
      },
    ]);
  });

  it('accepts only enabled units applicable to the resource type', async () => {
    types.findOneBy.mockResolvedValue({
      id: 'type',
    } as BusinessDictionaryTypeEntity);
    items.findOneBy.mockResolvedValue({
      resourceTypes: ['hotel'],
    } as BusinessDictionaryItemEntity);
    await expect(
      service.validateUnit('roomNight', 'hotel'),
    ).resolves.toBeUndefined();
    await expect(
      service.validateUnit('roomNight', 'guide'),
    ).rejects.toMatchObject({ code: 'RESOURCE_UNIT_INVALID' });
  });
});
