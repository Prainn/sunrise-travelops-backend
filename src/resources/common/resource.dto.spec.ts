import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAttractionPriceDto } from '../attractions/dto/attraction.dto';
import { CreateGuideDto } from '../guides/dto/guide.dto';
import { CreateHotelDto, HotelQueryDto } from '../hotels/dto/hotel.dto';
import {
  CreateTransportDto,
  TransportQueryDto,
} from '../transports/dto/transport.dto';
import { ResourceStatus } from './resource.constants';
import {
  ResourceQueryDto,
  actualKeyword,
  actualPage,
  normalizeMoney,
} from './resource.dto';

describe('resource DTOs', () => {
  it('uses the common page and keyword query parameters', async () => {
    const query = plainToInstance(ResourceQueryDto, {
      page: 4,
      pageSize: 30,
      keyword: '  current  ',
    });
    expect(await validate(query)).toHaveLength(0);
    expect(actualPage(query)).toBe(4);
    expect(actualKeyword(query)).toBe('current');
  });

  it('normalizes monetary responses to two decimal places', () => {
    expect(normalizeMoney('12')).toBe('12.00');
    expect(normalizeMoney('12.5')).toBe('12.50');
  });

  it('accepts nullable hotel group fields and rejects invalid amounts', async () => {
    const valid = plainToInstance(CreateHotelDto, {
      code: 'HTL001',
      name: 'Hotel',
      province: 'Yunnan',
      city: 'Kunming',
      rating: 'international_five_star',
      facilities: '',
      breakfastIncluded: true,
      breakfast: '',
      address: '',
      phone: '',
      nearby: '',
      individualPrice: 300,
      groupPrice: null,
      minimumGroupSize: null,
      unit: 'roomNight',
      status: ResourceStatus.Enabled,
    });
    expect(await validate(valid)).toHaveLength(0);

    const invalid = plainToInstance(CreateHotelDto, {
      ...valid,
      groupPrice: -1,
      minimumGroupSize: 0,
    });
    expect((await validate(invalid)).map((error) => error.property)).toEqual(
      expect.arrayContaining(['groupPrice', 'minimumGroupSize']),
    );
  });

  it('rejects an unsupported hotel rating', async () => {
    const input = plainToInstance(CreateHotelDto, {
      code: 'HTL001',
      name: 'Hotel',
      province: 'Yunnan',
      city: 'Kunming',
      rating: 'five_stars',
      facilities: '',
      breakfastIncluded: true,
      breakfast: '',
      address: '',
      phone: '',
      nearby: '',
      individualPrice: 300,
      groupPrice: null,
      minimumGroupSize: null,
      unit: 'roomNight',
      status: ResourceStatus.Enabled,
    });

    expect((await validate(input)).map((error) => error.property)).toContain(
      'rating',
    );
  });

  it('validates hotel rating and transport service-level list filters', async () => {
    const hotelQuery = plainToInstance(HotelQueryDto, {
      page: 1,
      pageSize: 20,
      rating: 'three_stars',
    });
    const transportQuery = plainToInstance(TransportQueryDto, {
      page: 1,
      pageSize: 20,
      serviceLevel: 'luxury',
    });

    expect(
      (await validate(hotelQuery)).map((error) => error.property),
    ).toContain('rating');
    expect(
      (await validate(transportQuery)).map((error) => error.property),
    ).toContain('serviceLevel');
  });

  it('rejects non-positive transport seats', async () => {
    const input = plainToInstance(CreateTransportDto, {
      code: 'VEH001',
      name: 'Coach',
      serviceLevel: 'standard',
      seats: 0,
      dailyPrice: '100.00',
      unit: 'vehicleDay',
      city: '',
      phone: '',
      remark: '',
      status: ResourceStatus.Enabled,
    });
    expect((await validate(input)).map((error) => error.property)).toContain(
      'seats',
    );
  });

  it('rejects an unsupported transport service level', async () => {
    const input = plainToInstance(CreateTransportDto, {
      code: 'VEH001',
      name: 'Coach',
      serviceLevel: 'luxury',
      seats: 20,
      dailyPrice: '100.00',
      unit: 'vehicleDay',
      city: '',
      phone: '',
      remark: '',
      status: ResourceStatus.Enabled,
    });

    expect((await validate(input)).map((error) => error.property)).toContain(
      'serviceLevel',
    );
  });

  it('validates guide service language, shopping flag and daily price', async () => {
    const input = plainToInstance(CreateGuideDto, {
      secondLanguage: 'unknown',
      shopping: 'no',
      dailyPrice: -1,
    });
    expect((await validate(input)).map((e) => e.property)).toEqual(
      expect.arrayContaining(['secondLanguage', 'shopping', 'dailyPrice']),
    );
    expect(
      await validate(
        plainToInstance(CreateGuideDto, {
          secondLanguage: 'en',
          shopping: false,
          dailyPrice: 600,
        }),
      ),
    ).toEqual([]);
  });

  it('accepts attraction prices without a supplier', async () => {
    const input = plainToInstance(CreateAttractionPriceDto, {
      itemType: 'ticket',
      itemName: 'Adult',
      audience: 'adult',
      periodName: '',
      startDate: null,
      endDate: null,
      rackPrice: 100,
      settlementPrice: 80,
      unit: 'personVisit',
      isFree: false,
      priceNote: '',
    });
    expect(await validate(input)).toEqual([]);
  });
});
