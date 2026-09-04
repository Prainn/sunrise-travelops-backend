import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAttractionPriceDto } from '../attractions/dto/attraction.dto';
import { CreateGuideDto } from '../guides/dto/guide.dto';
import { CreateHotelDto } from '../hotels/dto/hotel.dto';
import { CreateTransportDto } from '../transports/dto/transport.dto';
import { ResourceStatus } from './resource.constants';
import {
  ResourceQueryDto,
  actualKeyword,
  actualPage,
  normalizeMoney,
} from './resource.dto';

describe('resource DTOs', () => {
  it('uses pageNum and keywords as compatibility aliases', async () => {
    const query = plainToInstance(ResourceQueryDto, {
      page: 2,
      pageNum: 4,
      pageSize: 30,
      keyword: 'old',
      keywords: '  current  ',
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
      rating: 'five',
      facilities: '',
      breakfast: '',
      address: '',
      phone: '',
      nearby: '',
      basicRoomType: 'Twin',
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

  it('rejects non-positive transport seats', async () => {
    const input = plainToInstance(CreateTransportDto, {
      code: 'VEH001',
      name: 'Coach',
      plateNumber: '',
      seats: 0,
      dailyPrice: '100.00',
      unit: 'vehicleDay',
      city: '',
      contact: '',
      phone: '',
      remark: '',
      status: ResourceStatus.Enabled,
    });
    expect((await validate(input)).map((error) => error.property)).toContain(
      'seats',
    );
  });

  it('validates guide enums, languages, age and optional daily price', async () => {
    const input = plainToInstance(CreateGuideDto, {
      code: 'GDE001',
      name: 'Guide',
      certificateNo: 'C001',
      gender: 'unknown',
      age: 0,
      languages: [],
      employmentType: 'temporary',
      identityNumber: 'ID001',
      phone: '10086',
      dailyPrice: -1,
      unit: 'guideDay',
      hasLaborContract: false,
      isGroundOperatorProvided: false,
      groundOperatorId: 'not-a-uuid',
      licensePhotoUrl: '',
      remark: '',
      status: ResourceStatus.Enabled,
    });
    const properties = (await validate(input)).map((error) => error.property);
    expect(properties).toEqual(
      expect.arrayContaining([
        'gender',
        'age',
        'languages',
        'employmentType',
        'dailyPrice',
      ]),
    );
    expect(properties).not.toContain('groundOperatorId');
  });

  it('requires a supplier UUID only for supplier-provided attraction prices', async () => {
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
      isGroundOperatorProvided: true,
      groundOperatorId: null,
    });
    expect((await validate(input)).map((error) => error.property)).toContain(
      'groundOperatorId',
    );
  });
});
