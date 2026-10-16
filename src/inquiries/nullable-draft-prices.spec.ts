import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { priceDraft } from '../../test/fixtures/nullable-draft-prices';
import { ItineraryInput } from './inquiry.dto';
import { ItineraryValidation } from './itinerary-validation';
import { calculateItineraryQuote } from './quote-pricing';
import { contextualChanges, moneyResponse } from './changes';
import { recordPriceAdjustments } from './price-adjustments';

const validation = new ItineraryValidation();
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});
const parse = (body: unknown): Promise<ItineraryInput> =>
  pipe.transform(body, {
    type: 'body',
    metatype: ItineraryInput,
  }) as Promise<ItineraryInput>;
const manager = () =>
  ({
    find: jest.fn().mockResolvedValue([]),
    query: jest.fn().mockResolvedValue([]),
  }) as unknown as EntityManager;
const paths = [
  'hotelPlans[4].hotels[杭州].unitCost',
  'guidePlans[杭州].dailyPrice',
  'dailyPlans[day-1].items[restaurant].unitCost',
  'dailyPlans[day-1].items[attraction].unitCost',
];

describe('nullable Draft actual prices', () => {
  it('keeps explicit null through DTO conversion and normalization without reasons', async () => {
    const plan = await validation.normalize(
      manager(),
      await parse(priceDraft(null)),
      priceDraft(),
    );
    expect(plan.hotelPlans[0].hotels[0]).toMatchObject({
      unitCost: null,
      referencePrice: 100,
      adjustmentReason: '',
    });
    expect(plan.guidePlans[0]).toMatchObject({
      dailyPrice: null,
      referencePrice: 100,
      adjustmentReason: '',
    });
    expect(plan.dailyPlans[0].items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          unitCost: null,
          totalCost: null,
          referencePrice: 100,
        }),
      ]),
    );
    expect(await validation.normalize(manager(), plan, plan)).toEqual(plan);
  });

  it.each(['hotel', 'guide', 'item'] as const)(
    'rejects negative or missing %s price but accepts zero and amount strings',
    async (kind) => {
      for (const value of [
        -1,
        undefined,
        'invalid',
        Number.POSITIVE_INFINITY,
      ]) {
        const plan = priceDraft();
        const target =
          kind === 'hotel'
            ? plan.hotelPlans[0].hotels[0]
            : kind === 'guide'
              ? plan.guidePlans[0]
              : plan.dailyPlans[0].items[0];
        Object.assign(target, {
          [kind === 'guide' ? 'dailyPrice' : 'unitCost']: value,
        });
        await expect(parse(plan)).rejects.toThrow(BadRequestException);
      }
      await expect(parse(priceDraft(0))).resolves.toBeDefined();
      const plan = priceDraft();
      Object.assign(plan.guidePlans[0], { dailyPrice: '12.34' });
      expect((await parse(plan)).guidePlans[0].dailyPrice).toBe(12.34);
    },
  );

  it('returns incomplete pricing and nullable details, summing only priced components', async () => {
    const plan = await validation.normalize(
      manager(),
      priceDraft(null),
      priceDraft(),
    );
    const result = calculateItineraryQuote(plan);
    expect(result).toMatchObject({
      pricingComplete: false,
      missingPrices: paths,
      guideCost: 0,
      mealCost: 0,
      attractionCost: 0,
      dailyResourceCost: 0,
      mealDetails: [{ unitCost: null, totalCost: null }],
      attractionDetails: [{ unitCost: null, totalCost: null }],
      options: [
        {
          hotelUnitCost: 0,
          hotelCityCosts: [{ unitCost: null, totalCost: null }],
          paxPrices: [{ baseCostPerPerson: 10 }],
        },
      ],
    });
    plan.dailyPlans[0].items[0].unitCost = 100;
    const partial = calculateItineraryQuote(plan);
    expect(partial.mealCost).toBe(33.33);
    expect(partial.options[0].paxPrices[0].baseCostPerPerson).toBe(43.33);
    expect(partial.missingPrices).not.toContain(paths[2]);
    expect(moneyResponse(result)).toMatchObject({
      guideCost: '0.00',
      mealDetails: [{ unitCost: null, totalCost: null }],
    });
  });

  it('blocks PDF/freeze for every missing price and permits filled prices including zero', () => {
    for (const [kind, index] of [
      ['hotel', 0],
      ['guide', 1],
      ['restaurant', 2],
      ['attraction', 3],
    ] as const) {
      const plan = priceDraft();
      if (kind === 'hotel') plan.hotelPlans[0].hotels[0].unitCost = null;
      else if (kind === 'guide') plan.guidePlans[0].dailyPrice = null;
      else
        plan.dailyPlans[0].items.find((i) => i.type === kind)!.unitCost = null;
      try {
        validation.assertPdfReady(plan);
        throw new Error('Expected rejection');
      } catch (error) {
        expect(error).toMatchObject({
          code: 'PDF_NOT_READY',
          status: 400,
          details: { issues: [paths[index]] },
        });
      }
    }
    for (const price of [0, 100]) {
      expect(() => validation.assertPdfReady(priceDraft(price))).not.toThrow();
      expect(calculateItineraryQuote(priceDraft(price))).toMatchObject({
        pricingComplete: true,
        missingPrices: [],
      });
    }
  });

  it('requires reasons after filling null away from reference, retaining existing repricing rules', async () => {
    await expect(
      validation.normalize(manager(), priceDraft(), priceDraft(null)),
    ).resolves.toBeDefined();
    const changed = priceDraft(101);
    await expect(
      validation.normalize(manager(), changed, priceDraft(null)),
    ).rejects.toMatchObject({ code: 'ITINERARY_INVALID' });
    await expect(
      validation.normalize(manager(), changed, priceDraft(null), 1, false),
    ).resolves.toBeDefined();
    for (const hotel of changed.hotelPlans[0].hotels)
      hotel.adjustmentReason = '本次定价';
    for (const guide of changed.guidePlans) guide.adjustmentReason = '本次定价';
    for (const item of changed.dailyPlans[0].items)
      item.adjustmentReason = '本次定价';
    await expect(
      validation.normalize(manager(), changed, priceDraft(null)),
    ).resolves.toBeDefined();
    await expect(
      validation.normalize(manager(), priceDraft(), changed),
    ).rejects.toMatchObject({ code: 'ITINERARY_INVALID' });
  });

  it('allows custom meals with null price but requires a reason for their first actual price', async () => {
    const plan = priceDraft(null);
    Object.assign(plan.dailyPlans[0].items[0], {
      resourceId: null,
      resourceName: '自定义餐食',
    });
    const saved = await validation.normalize(manager(), plan, priceDraft());
    expect(saved.dailyPlans[0].items[0]).toMatchObject({
      unitCost: null,
      totalCost: null,
      referencePrice: null,
      adjustmentReason: '',
    });
    const filled = structuredClone(saved);
    filled.dailyPlans[0].items[0].unitCost = 0;
    await expect(
      validation.normalize(manager(), filled, saved),
    ).rejects.toMatchObject({ code: 'ITINERARY_INVALID' });
    filled.dailyPlans[0].items[0].adjustmentReason = '免费餐';
    expect(
      (await validation.normalize(manager(), filled, saved)).dailyPlans[0]
        .items[0].totalCost,
    ).toBe(0);
  });

  it('records null/zero field differences without zero or null adjustment inserts on clearing', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const db = { query } as unknown as EntityManager;
    const actor = { id: 'actor', name: '计调' };
    const cleared = priceDraft(null);
    await recordPriceAdjustments(
      db,
      'itinerary',
      priceDraft(0),
      cleared,
      actor,
    );
    expect(query).not.toHaveBeenCalled();
    const changes = moneyResponse(contextualChanges(priceDraft(0), cleared));
    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: paths[0],
          before: '0.00',
          after: null,
        }),
        expect.objectContaining({
          path: paths[1],
          before: '0.00',
          after: null,
        }),
        expect.objectContaining({
          path: paths[2],
          before: '0.00',
          after: null,
        }),
      ]),
    );
    await recordPriceAdjustments(db, 'itinerary', cleared, priceDraft(), actor);
    expect(query).not.toHaveBeenCalled();
    const filled = priceDraft(101);
    filled.hotelPlans[0].hotels[0].adjustmentReason = '首次补价';
    await recordPriceAdjustments(db, 'itinerary', cleared, filled, actor);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('itinerary_price_adjustments'),
      expect.arrayContaining([null, 101, 'initial']),
    );
  });
});
