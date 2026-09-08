import { CityEntity } from '../cities/city.entity';
import { Repository } from 'typeorm';
import { BusinessDictionaryItemEntity } from '../../system/business-dictionaries/business-dictionary-item.entity';
import { BusinessDictionaryTypeEntity } from '../../system/business-dictionaries/business-dictionary-type.entity';
import { SupplierEntity } from '../suppliers/supplier.entity';
import { ResourceStatus } from './resource.constants';
import { ResourceValidationService } from './resource-validation.service';

describe('ResourceValidationService', () => {
  let types: jest.Mocked<Repository<BusinessDictionaryTypeEntity>>;
  let items: jest.Mocked<Repository<BusinessDictionaryItemEntity>>;
  let suppliers: jest.Mocked<Repository<SupplierEntity>>;
  let cities: jest.Mocked<Repository<CityEntity>>;
  let service: ResourceValidationService;

  beforeEach(() => {
    types = { findOneBy: jest.fn() } as unknown as jest.Mocked<
      Repository<BusinessDictionaryTypeEntity>
    >;
    items = { findOneBy: jest.fn() } as unknown as jest.Mocked<
      Repository<BusinessDictionaryItemEntity>
    >;
    suppliers = { findOneBy: jest.fn() } as unknown as jest.Mocked<
      Repository<SupplierEntity>
    >;
    cities = { findOneBy: jest.fn() } as unknown as jest.Mocked<
      Repository<CityEntity>
    >;
    service = new ResourceValidationService(types, items, suppliers, cities);
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

  it('clears direct supplier ids and validates enabled supplier references', async () => {
    await expect(
      service.validateGroundOperator(false, 'ignored'),
    ).resolves.toBeNull();
    await expect(
      service.validateGroundOperator(true, null),
    ).rejects.toMatchObject({ code: 'GROUND_OPERATOR_REQUIRED' });
    suppliers.findOneBy.mockResolvedValue(null);
    await expect(
      service.validateGroundOperator(
        true,
        '00000000-0000-4000-8000-000000000001',
      ),
    ).rejects.toMatchObject({ code: 'GROUND_OPERATOR_NOT_FOUND_OR_DISABLED' });
    suppliers.findOneBy.mockResolvedValue({
      id: 'supplier',
      status: ResourceStatus.Enabled,
    } as SupplierEntity);
    await expect(
      service.validateGroundOperator(
        true,
        '00000000-0000-4000-8000-000000000001',
      ),
    ).resolves.toBe('00000000-0000-4000-8000-000000000001');
  });
});
