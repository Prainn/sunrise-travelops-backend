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
      'applies the description requirement by resource kind for %j',
      async (description) => {
        const result = validation.normalize(
          manager(type, description, '0.00'),
          await input(type, 0),
        );
        if (type === 'restaurant')
          await expect(result).rejects.toMatchObject({
            code: 'ITINERARY_INVALID',
            status: 400,
          });
        else
          expect((await result).dailyPlans[0].items[0]).toMatchObject({
            referencePrice: 0,
            resourceName: '资源当前名称',
          });
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

describe('day count and recycle normalization', () => {
  const validation = new ItineraryValidation();
  it('accepts edited day counts but keeps the initial planned-day gate', async () => {
    const plan = await input('attraction', 0);
    plan.dailyPlans[0].items = [];
    const db = manager('attraction', '描述', '0.00');
    await expect(
      validation.normalize(db, plan, undefined, 3),
    ).rejects.toMatchObject({ code: 'ITINERARY_INVALID' });
    const saved = await validation.normalize(db, plan, plan, 3);
    expect(saved.dailyPlans).toHaveLength(1);
  });

  it('preserves recycled resource reference and original date and restores without repricing', async () => {
    const previous = await input('attraction');
    Object.assign(previous.dailyPlans[0].items[0], {
      referencePrice: 100,
      referenceBasis: 'resource_price',
    });
    const active = {
      ...structuredClone(previous.dailyPlans[0]),
      id: 'active',
      items: [],
    };
    const current = {
      ...structuredClone(previous),
      dailyPlans: [active],
      deletedDays: [
        { day: previous.dailyPlans[0], originalDate: '2026-10-14' },
      ],
    };
    const recycled = await validation.normalize(
      manager('attraction', '', null),
      current,
      previous,
      2,
    );
    expect(recycled.deletedDays?.[0].day.items[0]).toMatchObject({
      resourceName: '历史名称',
      unitCost: 100,
    });
    const restored = await validation.normalize(
      manager('attraction', '', null),
      {
        ...recycled,
        dailyPlans: [recycled.deletedDays![0].day, active],
        deletedDays: [],
      },
      recycled,
      2,
    );
    expect(restored.dailyPlans[0].items[0]).toMatchObject({
      resourceName: '历史名称',
      referencePrice: 100,
      unitCost: 100,
    });
    expect(restored.dailyPlans[1].date).toBe('2026-10-15');
  });

  it('rejects ID collisions across active and recycled days', async () => {
    const plan = await input('attraction');
    plan.deletedDays = [
      {
        day: structuredClone(plan.dailyPlans[0]),
        originalDate: plan.startDate,
      },
    ];
    await expect(
      validation.normalize(manager('attraction', '描述', '100.00'), plan),
    ).rejects.toMatchObject({ code: 'ITINERARY_INVALID' });
  });
});
