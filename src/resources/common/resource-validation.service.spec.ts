import { Repository } from 'typeorm';
import { BusinessDictionaryItemEntity } from '../../system/business-dictionaries/business-dictionary-item.entity';
import { BusinessDictionaryTypeEntity } from '../../system/business-dictionaries/business-dictionary-type.entity';
import { CityEntity } from '../cities/city.entity';
import { ResourceValidationService } from './resource-validation.service';

describe('attraction price item types', () => {
  const findItem = jest.fn();
  const service = new ResourceValidationService(
    {
      findOneBy: jest.fn().mockResolvedValue({ id: 'type-id' }),
    } as unknown as Repository<BusinessDictionaryTypeEntity>,
    {
      findOneBy: findItem,
    } as unknown as Repository<BusinessDictionaryItemEntity>,
    {} as Repository<CityEntity>,
  );

  it('accepts an enabled custom type beyond the original five', async () => {
    findItem.mockResolvedValue({ code: 'custom-ticket', status: 'enabled' });
    await expect(
      service.validateAttractionPriceItemType('custom-ticket'),
    ).resolves.toBeUndefined();
  });

  it('rejects missing types even when retaining a previous code', async () => {
    findItem.mockResolvedValue(null);
    await expect(
      service.validateAttractionPriceItemType('missing', 'missing'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
  });

  it('rejects selecting a disabled type but preserves it on an existing price', async () => {
    findItem.mockResolvedValue({ code: 'ticket', status: 'disabled' });
    await expect(
      service.validateAttractionPriceItemType('ticket'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      service.validateAttractionPriceItemType('ticket', 'guide'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      service.validateAttractionPriceItemType('ticket', 'ticket'),
    ).resolves.toBeUndefined();
  });
});
