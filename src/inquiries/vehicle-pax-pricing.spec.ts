import { ValidationPipe } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { priceDraft } from '../../test/fixtures/nullable-draft-prices';
import { ItineraryInput } from './inquiry.dto';
import { ItineraryValidation } from './itinerary-validation';
import { calculateItineraryQuote } from './quote-pricing';
import { recordPriceAdjustments } from './price-adjustments';

const validation = new ItineraryValidation();
const manager = {
  find: jest.fn().mockResolvedValue([]),
  query: jest.fn().mockResolvedValue([]),
} as unknown as EntityManager;
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});
function fixture(mode: 'stage' | 'itinerary' = 'stage') {
  const plan = priceDraft();
  plan.paxTiers = [15, 20, 25];
  plan.quote.options[0].paxPrices = [];
  const vehicle = plan.vehiclePlans[0];
  vehicle.quotationMode = mode;
  vehicle.totalPrice = null;
  vehicle.paxPrices = plan.paxTiers.map((pax) => ({
    pax,
    totalPrice: null,
    pricingMode: 'automatic',
  }));
  const range = vehicle.arrangements[0];
  range.totalPrice = null;
  range.paxPrices = plan.paxTiers.map((pax, i) => ({
    pax,
    totalPrice: [13200, 14000, 15500][i],
  }));
  if (mode === 'itinerary')
    range.vehicles = [
      {
        vehicleId: '196fda0c-4337-4d78-b948-71e27ad31aa9',
        vehicleName: 'bus',
        seats: 30,
        quantity: 1,
      },
    ];
  return plan;
}
const normalize = (
  next: ItineraryInput,
  old = structuredClone(next),
  checkReason = true,
) => validation.normalize(manager, next, old, 1, checkReason);

describe('PAX vehicle pricing', () => {
  it.each(['stage', 'itinerary'] as const)(
    'calculates independent PAX prices in %s mode',
    async (mode) => {
      const input = fixture(mode);
      const parsed = (await pipe.transform(input, {
        type: 'body',
        metatype: ItineraryInput,
      })) as ItineraryInput;
      const plan = await normalize(parsed);
      const result = calculateItineraryQuote(plan);
      expect(result.options[0].vehicleTotal).toBeNull();
      expect(
        result.options[0].paxPrices.map((p) => [
          p.vehicleTotal,
          p.vehicleUnitCost,
        ]),
      ).toEqual([
        [13200, 880],
        [14000, 700],
        [15500, 620],
      ]);
      const edited = structuredClone(plan);
      edited.vehiclePlans[0].arrangements[0].paxPrices![1].totalPrice = 16000;
      const updated = calculateItineraryQuote(await normalize(edited, plan));
      expect(
        updated.options[0].paxPrices.map((p) => p.vehicleUnitCost),
      ).toEqual([880, 800, 620]);
      expect(() => validation.assertPdfReady(plan)).not.toThrow();
    },
  );
  it('keeps null distinct from free and blocks incomplete freezing', async () => {
    const input = fixture();
    input.vehiclePlans[0].arrangements[0].paxPrices![0].totalPrice = null;
    input.vehiclePlans[0].arrangements[0].paxPrices![1].totalPrice = 0;
    const plan = await normalize(input);
    expect(calculateItineraryQuote(plan)).toMatchObject({
      pricingComplete: false,
      missingPrices: ['vehiclePlans[standard].paxPrices[15].totalPrice'],
    });
    expect(plan.vehiclePlans[0].paxPrices![1].totalPrice).toBe(0);
    expect(() => validation.assertPdfReady(plan)).toThrow();
  });
  it.each(['duplicate', 'foreign', 'missing'] as const)(
    'rejects %s PAX rows',
    async (kind) => {
      const input = fixture();
      const rows = input.vehiclePlans[0].arrangements[0].paxPrices!;
      if (kind === 'duplicate') rows[1].pax = 15;
      if (kind === 'foreign') rows[1].pax = 99;
      if (kind === 'missing') rows.pop();
      await expect(normalize(input)).rejects.toThrow('完整且唯一');
    },
  );
  it.each([-1, 1.001, 'bad'])(
    'rejects invalid price %s at DTO boundary',
    async (value) => {
      const input = fixture();
      Object.assign(input.vehiclePlans[0].arrangements[0].paxPrices![0], {
        totalPrice: value,
      });
      await expect(
        pipe.transform(input, { type: 'body', metatype: ItineraryInput }),
      ).rejects.toThrow();
    },
  );
  it('requires confirmation and fresh ranges in both switch directions without mutating the saved input', async () => {
    for (const mode of ['stage', 'itinerary'] as const) {
      const old = await normalize(fixture(mode));
      const before = structuredClone(old);
      const next = fixture(mode === 'stage' ? 'itinerary' : 'stage');
      await expect(normalize(next, old)).rejects.toThrow('先确认');
      next.confirmVehicleModeChange = true;
      await expect(normalize(next, old)).rejects.toThrow('重新建立');
      next.vehiclePlans[0].arrangements[0].id = 'replacement';
      // Reuse an authoritative vehicle snapshot when switching into itinerary mode.
      const queryManager = {
        ...manager,
        findOneBy: jest.fn().mockResolvedValue({
          id: '196fda0c-4337-4d78-b948-71e27ad31aa9',
          name: 'bus',
          seats: 30,
          status: 'enabled',
          serviceLevel: 'standard',
        }),
      } as unknown as EntityManager;
      const saved = await validation.normalize(queryManager, next, old);
      expect(saved.confirmVehicleModeChange).toBeUndefined();
      expect(old).toEqual(before);
    }
  });
  it('requires mode confirmation even when replacing the vehicle tier', async () => {
    const old = await normalize(fixture());
    const next = fixture('itinerary');
    next.vehiclePlans[0].tier = 'vip';
    await expect(normalize(next, old)).rejects.toThrow('先确认');
  });
  it('rejects mixed modes, vehicles in stage mode and shared price ambiguity', async () => {
    const stage = fixture();
    stage.vehiclePlans[0].arrangements[0].vehicles =
      fixture('itinerary').vehiclePlans[0].arrangements[0].vehicles;
    await expect(normalize(stage)).rejects.toThrow('不能包含车型');
    const mixed = fixture();
    mixed.vehiclePlans.push({
      ...fixture('itinerary').vehiclePlans[0],
      tier: 'vip',
    });
    await expect(normalize(mixed)).rejects.toThrow('同一种');
    const shared = fixture();
    shared.vehiclePlans[0].totalPrice = 100;
    await expect(normalize(shared)).rejects.toThrow('共用');
  });
  it('rejects insufficient itinerary seats', async () => {
    const input = fixture('itinerary');
    input.vehiclePlans[0].arrangements[0].vehicles[0].seats = 20;
    await expect(normalize(input)).rejects.toThrow('insufficient seats');
  });
  it('requires a per-PAX manual adjustment reason, isolates history and permits automatic restoration', async () => {
    const old = await normalize(fixture('itinerary'));
    const next = structuredClone(old);
    Object.assign(next.vehiclePlans[0].paxPrices![1], {
      pricingMode: 'manual',
      totalPrice: 18000,
    });
    await expect(normalize(next, old)).rejects.toThrow('原因');
    await expect(normalize(next, old, false)).resolves.toBeDefined();
    next.vehiclePlans[0].paxPrices![1].adjustmentReason = '20人车型升级';
    const saved = await normalize(next, old);
    const query = jest
      .fn<Promise<unknown[]>, [string, unknown[]]>()
      .mockResolvedValue([]);
    await recordPriceAdjustments(
      { query } as unknown as EntityManager,
      'id',
      old,
      saved,
      { id: 'actor', name: 'test' },
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual(
      expect.arrayContaining([
        'vehicle:standard:20',
        14000,
        18000,
        '20人车型升级',
      ]),
    );
    const restored = structuredClone(saved);
    restored.vehiclePlans[0].paxPrices![1].pricingMode = 'automatic';
    expect(
      (await normalize(restored, saved)).vehiclePlans[0].paxPrices![1]
        .totalPrice,
    ).toBe(14000);
  });
});
