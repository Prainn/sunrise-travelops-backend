import { ValidationPipe } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ResourceStatus } from '../resources/common/resource.constants';
import { CityEntity } from '../resources/cities/city.entity';
import { ItineraryInput } from './inquiry.dto';
import { ItineraryValidation } from './itinerary-validation';

const resourceId = 'aebaf903-6cda-470f-8cfa-8a7727784bc2';
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

async function input(
  type: 'attraction' | 'restaurant',
  unitCost = 100,
): Promise<ItineraryInput> {
  return pipe.transform(
    {
      title: '资源完整性回归',
      startDate: '2026-10-14',
      paxTiers: [10],
      childRate: 80,
      childWithoutBedRate: 60,
      destinations: ['杭州'],
      dailyPlans: [
        {
          id: 'day-1',
          dayNumber: 1,
          date: '2026-10-14',
          departure: '',
          destination: '杭州',
          overnightDestination: '',
          transport: '',
          description: '当日安排',
          meals: {
            breakfast: false,
            lunch: type === 'restaurant',
            dinner: false,
          },
          items: [
            {
              id: 'item-1',
              type,
              resourceId,
              resourceName: '历史名称',
              priceName: '',
              unit: type === 'restaurant' ? 'personMeal' : 'personVisit',
              quantity: 1,
              unitCost,
              totalCost: unitCost,
              remark: '',
              ...(type === 'restaurant' ? { mealSlot: 'lunch' } : {}),
            },
          ],
        },
      ],
      hotelPlans: [],
      vehiclePlans: [],
      guidePlans: [],
      quote: {
        staffRoomCosts: [],
        options: [],
        transportFees: [],
        customerNotes: '',
        holidayRestrictions: '',
        hotelReplacementTerms: '',
      },
    },
    { type: 'body', metatype: ItineraryInput },
  ) as Promise<ItineraryInput>;
}

function manager(
  type: 'attraction' | 'restaurant',
  description: string,
  price: string | null,
) {
  return {
    find: jest
      .fn()
      .mockImplementation((entity: unknown) =>
        Promise.resolve(
          entity === CityEntity
            ? [{ name: '杭州', status: ResourceStatus.Enabled }]
            : [],
        ),
      ),
    findOne: jest.fn().mockResolvedValue({
      id: resourceId,
      name: '资源当前名称',
      description,
      price,
      status: ResourceStatus.Enabled,
      deletedAt: null,
      unit: type === 'restaurant' ? 'personMeal' : 'personVisit',
    }),
  } as unknown as EntityManager;
}

describe.each(['attraction', 'restaurant'] as const)(
  '%s selection completeness',
  (type) => {
    const validation = new ItineraryValidation();

    it.each(['', '   ', '\t\n', '　'])(
      'rejects new selection with blank description %j',
      async (description) => {
        await expect(
          validation.normalize(
            manager(type, description, '100.00'),
            await input(type),
          ),
        ).rejects.toMatchObject({ code: 'ITINERARY_INVALID', status: 400 });
      },
    );

    it('rejects missing price even when the description is complete', async () => {
      await expect(
        validation.normalize(
          manager(type, '有效描述', null),
          await input(type),
        ),
      ).rejects.toMatchObject({ code: 'ITINERARY_INVALID' });
    });

    it.each([0, 100])(
      'accepts a complete resource priced at %s',
      async (price) => {
        const result = await validation.normalize(
          manager(type, ' 有效描述 ', price.toFixed(2)),
          await input(type, price),
        );
        expect(result.dailyPlans[0].items[0]).toMatchObject({
          referencePrice: price,
          resourceName: '资源当前名称',
        });
      },
    );

    it('preserves an existing reference even if the current resource is incomplete', async () => {
      const previous = await input(type);
      Object.assign(previous.dailyPlans[0].items[0], {
        referencePrice: 100,
        referenceBasis: 'resource_price',
      });
      const current = structuredClone(previous);
      const db = manager(type, '', null);
      const result = await validation.normalize(db, current, previous);
      expect(result.dailyPlans[0].items[0]).toMatchObject({
        resourceName: '历史名称',
        unitCost: 100,
        referencePrice: 100,
      });
    });
  },
);
