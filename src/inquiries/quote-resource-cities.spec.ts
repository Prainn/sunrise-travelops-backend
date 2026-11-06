import { DataSource, EntityManager, In } from 'typeorm';
import { InquiriesService } from './inquiries.service';
import { ItineraryInput } from './inquiry.dto';
import { ItineraryValidation } from './itinerary-validation';
import { AgenciesService } from '../resources/agencies/agencies.service';
import { RestaurantEntity } from '../resources/restaurants/restaurant.entity';
import { AttractionEntity } from '../resources/attractions/attraction.entity';

function fixture(): ItineraryInput {
  return {
    title: '城市汇总测试',
    startDate: '2026-11-06',
    destinations: ['丽江'],
    paxTiers: [2],
    childRate: 80,
    childWithoutBedRate: 60,
    hotelPlans: [],
    vehiclePlans: [],
    guidePlans: [],
    quote: {
      chineseTip: null,
      englishTip: null,
      mealOtherCost: 5,
      attractionOtherCost: 7,
      options: [],
      staffRoomCosts: [],
      paxOtherCosts: [],
      mealOtherReason: '餐食其他',
      attractionOtherReason: '景点其他',
      transportFees: [],
      customerNotes: '',
      holidayRestrictions: '',
      hotelReplacementTerms: '',
    },
    dailyPlans: [
      {
        id: 'day-1',
        date: '2026-11-06',
        departure: '昆明',
        overnightDestination: '丽江',
        meals: { breakfast: false, lunch: true, dinner: true },
        transport: '',
        dayNumber: 1,
        destination: '丽江',
        items: [
          {
            id: 'item-1',
            priceName: '',
            totalCost: null,
            remark: '',
            type: 'restaurant',
            resourceId: 'meal',
            resourceName: '餐厅',
            unit: 'table',
            unitCost: 100,
            dinerCount: 2,
            quantity: 2,
          },
          {
            id: 'item-2',
            priceName: '',
            totalCost: null,
            remark: '',
            type: 'restaurant',
            resourceId: 'meal',
            resourceName: '餐厅',
            unit: 'person',
            dinerCount: null,
            unitCost: 10,
            quantity: 1,
          },
          {
            id: 'item-3',
            priceName: '',
            totalCost: null,
            remark: '',
            type: 'attraction',
            resourceId: 'sight',
            resourceName: '景点',
            unit: 'person',
            dinerCount: null,
            unitCost: 20,
            quantity: 1,
          },
          {
            id: 'item-4',
            priceName: '',
            totalCost: null,
            remark: '',
            type: 'restaurant',
            resourceId: null,
            resourceName: '自定义餐食',
            unit: 'person',
            dinerCount: null,
            unitCost: null,
            quantity: 1,
          },
        ],
      },
    ],
  };
}

function serviceFor(manager: EntityManager) {
  return new InquiriesService(
    { manager } as DataSource,
    {} as ItineraryValidation,
    {} as AgenciesService,
  );
}

describe('quote resource cities', () => {
  it('loads only referenced resource IDs and keeps resource cities and calculated costs', async () => {
    const find = jest.fn().mockImplementation((entity: unknown) => {
      if (entity === RestaurantEntity) return [{ id: 'meal', city: '昆明' }];
      if (entity === AttractionEntity) return [{ id: 'sight', area: '大理' }];
      throw new Error('unexpected resource');
    });
    const manager = { find } as unknown as EntityManager;
    const result = await serviceFor(manager)['calculateQuote'](
      fixture(),
      manager,
    );
    expect(find).toHaveBeenCalledTimes(2);
    expect(find).toHaveBeenCalledWith(RestaurantEntity, {
      where: { id: In(['meal']) },
      select: { id: true, city: true },
    });
    expect(find).toHaveBeenCalledWith(AttractionEntity, {
      where: { id: In(['sight']) },
      select: { id: true, area: true },
    });
    expect(result.mealDetails).toMatchObject([
      { city: '昆明', unitCost: 50, totalCost: 100 },
      { city: '昆明', totalCost: 10 },
      { city: null, totalCost: null },
    ]);
    expect(result.attractionDetails).toMatchObject([
      { city: '大理', totalCost: 20 },
    ]);
    expect(result.mealCost).toBe(115);
    expect(result.attractionCost).toBe(27);
  });

  it('does not infer a missing resource city from the day destination', async () => {
    const manager = {
      find: jest.fn().mockResolvedValue([]),
    } as unknown as EntityManager;
    const result = await serviceFor(manager)['calculateQuote'](fixture());
    expect(result.mealDetails?.every((detail) => detail.city === null)).toBe(
      true,
    );
    expect(result.attractionDetails?.[0].city).toBeNull();
  });

  it('reads frozen calculations unchanged without querying current resources', async () => {
    const calculation = {
      pricingVersion: 2,
      mealDetails: [{ resourceName: '历史餐食', totalCost: 10 }],
    };
    const find = jest.fn();
    const manager = {
      find,
      findOneByOrFail: jest
        .fn()
        .mockResolvedValue({ snapshot: { calculation } }),
    } as unknown as EntityManager;
    const service = serviceFor(manager);
    service['pair'] = jest
      .fn()
      .mockResolvedValue({ itinerary: { status: 'quoted' } });
    const result = await service.quoteCalculation(
      'frozen-id',
      {} as Parameters<typeof service.quoteCalculation>[1],
    );
    expect(result).toBe(calculation);
    expect(find).not.toHaveBeenCalled();
  });
});
