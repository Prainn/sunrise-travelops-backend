import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Repository } from 'typeorm';
import { CreateHotelDto, UpdateHotelDto } from '../hotels/dto/hotel.dto';
import {
  CreateAgencyDto,
  CreateAgencyContactDto,
  UpdateAgencyContactDto,
} from '../agencies/dto/agency.dto';
import { CreateCityDto } from '../cities/dto/city.dto';
import { CreateTransportDto } from '../transports/dto/transport.dto';
import { CreateGuideDto } from '../guides/dto/guide.dto';
import { CreateGuidePersonDto } from '../guides/dto/guide-person.dto';
import { CreateFlightDto } from '../flights/dto/flight.dto';
import { CreateRestaurantDto } from '../restaurants/dto/restaurant.dto';
import { CreateAttractionDto } from '../attractions/dto/attraction.dto';
import { insertResource } from './resource-service.helpers';

const id = '11111111-1111-4111-8111-111111111111';
const validation = {
  whitelist: true,
  forbidNonWhitelisted: true,
  skipMissingProperties: true,
};
describe('resource create identity boundary', () => {
  it.each([
    CreateHotelDto,
    CreateAgencyDto,
    CreateCityDto,
    CreateTransportDto,
    CreateGuideDto,
    CreateGuidePersonDto,
    CreateFlightDto,
    CreateAgencyContactDto,
    CreateRestaurantDto,
    CreateAttractionDto,
  ])('%s rejects an existing client ID', (dto) => {
    const errors = validateSync(
      plainToInstance(dto as new () => object, { id }),
      validation,
    );
    expect(errors.find((e) => e.property === 'id')?.constraints).toHaveProperty(
      'whitelistValidation',
    );
  });
  it.each([UpdateHotelDto, UpdateAgencyContactDto])(
    '%s keeps explicit update identity',
    (dto) => {
      expect(
        validateSync(
          plainToInstance(dto as new () => object, { id, version: 1 }),
          validation,
        ),
      ).toEqual([]);
    },
  );
  it('inserts under a new server ID even when an internal caller supplies an existing ID', async () => {
    const existing = { id, name: 'Existing' };
    const records = new Map([[id, existing]]);
    const insert = jest.fn((entity: typeof existing) => {
      if (records.has(entity.id)) throw new Error('duplicate');
      records.set(entity.id, { ...entity });
      return Promise.resolve({});
    });
    const repo = {
      insert,
      findOneByOrFail: ({ id: key }: { id: string }) =>
        Promise.resolve(records.get(key)),
    } as unknown as Repository<typeof existing>;
    const result = await insertResource(repo, { id, name: 'New' });
    expect(result.id).not.toBe(id);
    expect(records.get(id)).toEqual(existing);
    expect(records.size).toBe(2);
  });
  it.each(['HTL-9223372036854775808', 'HTL-1000000000000000000'])(
    'rejects unsafe code %s',
    (code) => {
      expect(
        validateSync(
          plainToInstance(CreateHotelDto, { code }),
          validation,
        ).some((e) => e.property === 'code'),
      ).toBe(true);
    },
  );
  it.each(['HTL-001', 'HTL-100', 'HTL-999999999999999999'])(
    'accepts bounded code %s',
    (code) => {
      expect(
        validateSync(plainToInstance(CreateHotelDto, { code }), validation),
      ).toEqual([]);
    },
  );
});
