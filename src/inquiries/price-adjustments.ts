import { EntityManager } from 'typeorm';
import { ItineraryInput } from './inquiry.dto';
import { roundMoney } from './money';
import { BusinessException } from '../common/exceptions/business.exception';
import { HttpStatus } from '@nestjs/common';
export interface ReferencePrice {
  referencePrice?: number | null;
  referenceBasis?: string | null;
  adjustmentReason?: string | null;
}
export function requirePriceReason(
  actual: number | null,
  previous: number | null | undefined,
  fields: ReferencePrice,
  old: ReferencePrice | undefined,
  checkReason: boolean,
  allowRestoreWithoutReason = false,
) {
  if (actual === null) {
    fields.adjustmentReason = '';
    return;
  }
  const changed =
    previous == null || roundMoney(previous) !== roundMoney(actual);
  const reference = fields.referencePrice;
  const restored =
    reference != null && roundMoney(actual) === roundMoney(reference);
  const needsReason =
    changed && (!restored || (previous != null && !allowRestoreWithoutReason));
  if (needsReason && checkReason && !fields.adjustmentReason?.trim())
    throw new BusinessException({
      code: 'ITINERARY_INVALID',
      message: '调整价格必须填写本次原因',
      status: HttpStatus.BAD_REQUEST,
    });
  fields.adjustmentReason = changed
    ? needsReason
      ? (fields.adjustmentReason?.trim() ?? '')
      : ''
    : (old?.adjustmentReason ?? fields.adjustmentReason ?? '');
}
function prices(data: ItineraryInput) {
  return [
    ...[
      ...data.dailyPlans,
      ...(data.deletedDays ?? []).map((entry) => entry.day),
    ].flatMap((d) =>
      d.items.map((i) => ({
        key: `item:${i.id}`,
        name: `D${d.dayNumber} · ${i.resourceName}`,
        source: `${i.resourceId}`,
        price: i.unitCost,
        ...i,
      })),
    ),
    ...data.hotelPlans.flatMap((p) =>
      p.hotels.map((h) => ({
        key: `hotel:${p.tier}:${h.destination}`,
        type: 'hotel',
        name: h.hotelName,
        source: `${h.hotelId}:${h.referenceBasis ?? 'unknown'}`,
        price: h.unitCost,
        ...h,
      })),
    ),
    ...data.guidePlans.map((g) => ({
      key: `guide:${g.destination}`,
      type: 'guide',
      name: g.guideName,
      source: g.guideId,
      price: g.dailyPrice,
      ...g,
    })),
    ...data.vehiclePlans.flatMap((v) =>
      (v.paxPrices ?? [])
        .filter((p) => p.totalPrice != null)
        .map((p) => ({
          key: `vehicle:${v.tier}:${p.pax}`,
          type: 'vehicle',
          name: `${v.tier === 'vip' ? 'VIP' : '标准'}车辆全程总价 · ${p.pax} PAX`,
          source: `${v.tier}:${p.pax}:${p.pricingMode}:${p.segmentTotal}`,
          price: p.totalPrice!,
          referencePrice: p.segmentTotal,
          referenceBasis: p.segmentTotal == null ? 'unknown' : 'segment_total',
          adjustmentReason: p.adjustmentReason,
        })),
    ),
  ];
}
export async function recordPriceAdjustments(
  manager: EntityManager,
  itineraryId: string,
  previous: ItineraryInput | undefined,
  next: ItineraryInput,
  actor: { id: string; name: string },
) {
  const old = new Map(previous ? prices(previous).map((p) => [p.key, p]) : []);
  for (const item of prices(next)) {
    // Clearing a price is recorded by the ordinary field diff, not a zero-price adjustment.
    if (item.price === null) continue;
    // Initial PAX adoption compares with the existing shared vehicle total.
    const saved =
      old.get(item.key) ??
      (item.type === 'vehicle' && item.key.split(':').length === 3
        ? old.get(item.key.split(':').slice(0, 2).join(':'))
        : undefined);
    const before = saved?.price != null ? saved : undefined;
    const reference = item.referencePrice ?? null;
    if (
      before &&
      (before.source === item.source || item.type === 'vehicle') &&
      roundMoney(before.price!) === roundMoney(item.price)
    )
      continue;
    if (!before && item.type === 'vehicle') continue;
    if (
      !before &&
      (reference == null
        ? !item.adjustmentReason?.trim()
        : roundMoney(reference) === roundMoney(item.price))
    )
      continue;
    if (
      before &&
      item.type !== 'vehicle' &&
      before.source !== item.source &&
      reference != null &&
      roundMoney(reference) === roundMoney(item.price)
    )
      continue;
    const action =
      reference != null && roundMoney(reference) === roundMoney(item.price)
        ? 'restored'
        : before
          ? 'adjusted'
          : 'initial';
    await manager.query(
      `INSERT INTO itinerary_price_adjustments(itinerary_id,item_key,item_type,item_name,reference_basis,reference_price,before_price,after_price,reason,action,operator_id,operator_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        itineraryId,
        item.key,
        item.type,
        item.name,
        item.referenceBasis ?? 'unknown',
        reference,
        before?.price ?? null,
        item.price,
        item.adjustmentReason ?? '',
        action,
        actor.id,
        actor.name,
      ],
    );
  }
}
