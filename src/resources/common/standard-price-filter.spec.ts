import { ValidationPipe } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { createValidationException } from '../../common/validation/validation-exception.factory';
import { AttractionEntity } from '../attractions/attraction.entity';
import { AttractionsService } from '../attractions/attractions.service';
import { AttractionQueryDto } from '../attractions/dto/attraction.dto';
import { RestaurantQueryDto } from '../restaurants/dto/restaurant.dto';
import { RestaurantEntity } from '../restaurants/restaurant.entity';
import { RestaurantsService } from '../restaurants/restaurants.service';
import { ResourceValidationService } from './resource-validation.service';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: createValidationException,
});

describe.each([
  ['restaurant', RestaurantQueryDto],
  ['attraction', AttractionQueryDto],
] as const)('%s standard price list filter', (alias, dto) => {
  it.each([
    ['true', true],
    ['false', false],
    [undefined, undefined],
  ] as const)(
    'transforms %s and binds the intended SQL filter',
    async (input, expected) => {
      const query = (await pipe.transform(
        input === undefined ? {} : { isStandardPrice: input },
        { type: 'query', metatype: dto },
      )) as RestaurantQueryDto & AttractionQueryDto;
      expect(query.isStandardPrice).toBe(expected);
      const builder = {
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      const repository = {
        createQueryBuilder: jest.fn().mockReturnValue(builder),
      };
      const service =
        alias === 'restaurant'
          ? new RestaurantsService(
              repository as unknown as Repository<RestaurantEntity>,
              {} as ResourceValidationService,
              {} as DataSource,
            )
          : new AttractionsService(
              repository as unknown as Repository<AttractionEntity>,
              {} as ResourceValidationService,
              {} as DataSource,
            );
      await service.list(query);
      if (expected === undefined)
        expect(builder.andWhere).not.toHaveBeenCalled();
      else
        expect(builder.andWhere).toHaveBeenCalledWith(
          `${alias}.isStandardPrice = :isStandardPrice`,
          { isStandardPrice: expected },
        );
    },
  );

  it('rejects unsupported boolean strings before querying', async () => {
    await expect(
      pipe.transform(
        { isStandardPrice: 'yes' },
        { type: 'query', metatype: dto },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
