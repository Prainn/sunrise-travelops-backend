import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthenticatedUser } from '../../auth/auth.types';
import {
  ResourceScopeInterceptor,
  resourceLibrary,
  scopeResources,
} from './resource-scope';
import { AgencyQueryDto } from '../agencies/dto/agency.dto';
import { CityQueryDto } from '../cities/dto/city.dto';
import { HotelQueryDto } from '../hotels/dto/hotel.dto';
import { RestaurantQueryDto } from '../restaurants/dto/restaurant.dto';
import { AttractionQueryDto } from '../attractions/dto/attraction.dto';
import { TransportQueryDto } from '../transports/dto/transport.dto';
import { GuideQueryDto } from '../guides/dto/guide.dto';
import { SelectQueryBuilder } from 'typeorm';
import { HotelEntity } from '../hotels/hotel.entity';

const headquarters = {
  scope: 'headquarters',
  resourceLibrary: null,
} as AuthenticatedUser;
function run(query: Record<string, unknown>, user = headquarters) {
  const qb = { andWhere: jest.fn().mockReturnThis() };
  const context = {
    switchToHttp: () => ({ getRequest: () => ({ user, query }) }),
  } as unknown as ExecutionContext;
  const handle = jest.fn(() => {
    scopeResources(qb as unknown as SelectQueryBuilder<HotelEntity>, 'r');
    return of(resourceLibrary());
  });
  const result = lastValueFrom(
    new ResourceScopeInterceptor().intercept(context, {
      handle,
    } as CallHandler),
  );
  return { result, qb, handle };
}

describe('resource business filter', () => {
  it.each([
    ['shengxu', 'shengxu'],
    ['linxi', 'shared'],
    ['website', 'shared'],
  ])(
    'maps %s to %s before resource SQL is executed',
    async (businessUnit, library) => {
      const { result, qb } = run({ businessUnit });
      expect(await result).toBe(library);
      expect(qb.andWhere).toHaveBeenCalledWith('r.library = :resourceLibrary', {
        resourceLibrary: library,
      });
    },
  );
  it('leaves headquarters all-library queries unfiltered', async () => {
    const { result, qb } = run({});
    expect(await result).toBeNull();
    expect(qb.andWhere).not.toHaveBeenCalled();
  });
  it('preserves ordinary account scope when the filter is omitted', async () => {
    expect(
      await run({}, {
        scope: 'linxi',
        resourceLibrary: 'shared',
      } as AuthenticatedUser).result,
    ).toBe('shared');
  });
  it.each(['shengxu', 'website'])(
    'rejects another business %s even if the resource library is shared',
    async (businessUnit) => {
      const { result, handle } = run({ businessUnit }, {
        scope: 'linxi',
        resourceLibrary: 'shared',
      } as AuthenticatedUser);
      await expect(result).rejects.toMatchObject({ status: 403 });
      expect(handle).not.toHaveBeenCalled();
    },
  );
  it('rejects conflicting business and library parameters', async () => {
    await expect(
      run({ businessUnit: 'website', library: 'shengxu' }).result,
    ).rejects.toMatchObject({ status: 403 });
  });
  it.each(['headquarters', 'other', '', ['linxi']])(
    'rejects invalid business filter %s',
    async (businessUnit) => {
      await expect(run({ businessUnit }).result).rejects.toMatchObject({
        status: 400,
      });
    },
  );
  it.each([
    AgencyQueryDto,
    CityQueryDto,
    HotelQueryDto,
    RestaurantQueryDto,
    AttractionQueryDto,
    TransportQueryDto,
    GuideQueryDto,
  ])('validates businessUnit on every resource query DTO', async (dto) => {
    expect(
      await validate(
        plainToInstance(dto, { page: 2, pageSize: 20, businessUnit: 'linxi' }),
      ),
    ).toEqual([]);
    const errors = await validate(
      plainToInstance(dto, {
        page: 2,
        pageSize: 20,
        businessUnit: 'headquarters',
      }),
    );
    expect(errors.some((error) => error.property === 'businessUnit')).toBe(
      true,
    );
  });
});
