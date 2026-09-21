import { EntityManager } from 'typeorm';
import { ItineraryInput } from './inquiry.dto';
import { roundMoney, sumMoney } from './money';
import { BusinessException } from '../common/exceptions/business.exception';
import { HttpStatus } from '@nestjs/common';
export interface ReferencePrice {
  referencePrice?: number | null;
  referenceBasis?: string | null;
  adjustmentReason?: string | null;
}
export function requirePriceReason(
  actual: number,
  previous: number | undefined,
  fields: ReferencePrice,
  old: ReferencePrice | undefined,
  checkReason: boolean,
  custom = false,
) {
  const changed =
    previous === undefined || roundMoney(previous) !== roundMoney(actual);
  const reference = fields.referencePrice;
  const restored =
    reference != null && roundMoney(actual) === roundMoney(reference);
  const needsReason =
    changed && !restored && !(custom && previous === undefined);
  if (needsReason && checkReason && !fields.adjustmentReason?.trim())
    throw new BusinessException({
      code: 'ITINERARY_INVALID',
      message: '调整价格必须填写本次原因',
      status: HttpStatus.BAD_REQUEST,
    });
  fields.adjustmentReason = restored
    ? ''
    : changed
      ? (fields.adjustmentReason?.trim() ?? '')
      : (old?.adjustmentReason ?? fields.adjustmentReason ?? '');
}
export function vehicleSegmentTotal(
  plan: ItineraryInput['vehiclePlans'][number],
) {
  return plan.arrangements.length &&
    plan.arrangements.every((a) => a.totalPrice != null)
    ? sumMoney(plan.arrangements.map((a) => a.totalPrice!))
    : null;
}
function prices(data: ItineraryInput) {
  return [
    ...data.dailyPlans.flatMap((d) =>
      d.items.map((i) => ({
        key: `item:${i.id}`,
        name: `D${d.dayNumber} · ${i.resourceName}`,
        source: `${i.resourceId}:${i.resourcePriceId}`,
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
    ...data.vehiclePlans
      .filter((v) => v.totalPrice != null)
      .map((v) => ({
        key: `vehicle:${v.tier}`,
        type: 'vehicle',
        name: v.tier === 'vip' ? 'VIP 车辆全程总价' : '标准车辆全程总价',
        source: `${v.tier}:${v.pricingMode ?? 'unknown'}:${vehicleSegmentTotal(v)}`,
        price: v.totalPrice!,
        referencePrice: v.segmentTotal,
        referenceBasis: v.segmentTotal == null ? 'unknown' : 'segment_total',
        adjustmentReason: v.adjustmentReason,
      })),
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
    const before = old.get(item.key);
    const reference = item.referencePrice ?? null;
    if (
      before &&
      before.source === item.source &&
      roundMoney(before.price) === roundMoney(item.price)
    )
      continue;
    if (
      !before &&
      (reference == null
        ? !item.adjustmentReason?.trim()
        : roundMoney(reference) === roundMoney(item.price))
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
