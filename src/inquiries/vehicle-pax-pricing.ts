import { BusinessException } from '../common/exceptions/business.exception';
import { ItineraryInput } from './inquiry.dto';
import { requirePriceReason } from './price-adjustments';
import { roundMoney, sumMoney } from './money';

type Plan = ItineraryInput['vehiclePlans'][number];
const invalid = (message: string): never => {
  throw new BusinessException({
    code: 'ITINERARY_INVALID',
    message,
    status: 400,
  });
};

/** Explicit new-mode adoption protects PAX prices from older editors. */
export function validateVehicleModeChange(
  next: ItineraryInput,
  previous?: ItineraryInput,
) {
  const confirmed = next.confirmVehicleModeChange === true;
  delete next.confirmVehicleModeChange;
  if (new Set(next.vehiclePlans.map((p) => p.quotationMode)).size > 1)
    invalid('所有车型必须使用同一种用车报价方式');
  for (const plan of next.vehiclePlans) {
    const replacedPlans = (previous?.vehiclePlans ?? []).filter(
      (old) =>
        old.arrangements.length && old.quotationMode !== plan.quotationMode,
    );
    if (replacedPlans.length) {
      if (!confirmed) invalid('更改用车报价方式会清空原方式的报价，请先确认');
      if (
        plan.arrangements.some((a) =>
          replacedPlans.some((old) =>
            old.arrangements.some((b) => b.id === a.id),
          ),
        )
      )
        invalid('切换用车报价方式后必须重新建立安排，不得沿用原报价阶段');
    }
  }
}

function validatePaxRows(
  rows: { pax: number; totalPrice: number | null }[] | undefined,
  paxTiers: number[],
) {
  if (
    !rows ||
    rows.length !== paxTiers.length ||
    new Set(rows.map((p) => p.pax)).size !== rows.length ||
    rows.some((p) => !paxTiers.includes(p.pax))
  )
    return invalid('用车价格必须完整且唯一地覆盖行程人数档位');
  for (const row of rows) {
    row.totalPrice ??= null;
    if (row.totalPrice !== null) row.totalPrice = roundMoney(row.totalPrice);
  }
  rows.sort((a, b) => a.pax - b.pax);
}

export function normalizeVehiclePaxPrices(
  plan: Plan,
  paxTiers: number[],
  old: Plan | undefined,
  checkReason: boolean,
) {
  if (
    plan.totalPrice != null ||
    plan.arrangements.some((a) => a.totalPrice != null)
  )
    invalid('分档报价不能同时填写跨人数档共用的用车价格');
  validatePaxRows(plan.paxPrices, paxTiers);
  for (const range of plan.arrangements) {
    validatePaxRows(range.paxPrices, paxTiers);
    if (plan.quotationMode === 'stage' && range.vehicles.length)
      invalid('按阶段报价不能包含车型明细');
  }
  for (const price of plan.paxPrices!) {
    const segmentPrices = plan.arrangements.map(
      (a) => a.paxPrices!.find((p) => p.pax === price.pax)!.totalPrice,
    );
    price.segmentTotal =
      segmentPrices.length && segmentPrices.every((p) => p != null)
        ? sumMoney(segmentPrices)
        : null;
    const before = old?.paxPrices?.find((p) => p.pax === price.pax);
    if (plan.quotationMode === 'stage' && price.pricingMode !== 'automatic')
      invalid('按阶段报价的全程价格必须自动汇总');
    if (price.pricingMode === 'automatic') {
      price.totalPrice = price.segmentTotal;
      price.adjustmentReason = '';
    } else if (price.pricingMode === 'manual') {
      if (!plan.arrangements.length) price.totalPrice = null;
      const fields = {
        referencePrice: price.segmentTotal,
        adjustmentReason: price.adjustmentReason,
      };
      if (before?.totalPrice == null) fields.adjustmentReason = '';
      else
        requirePriceReason(
          price.totalPrice,
          before.totalPrice,
          fields,
          before,
          checkReason,
          true,
        );
      price.adjustmentReason = fields.adjustmentReason;
    } else invalid('无效的用车价格计算方式');
  }
  plan.totalPrice = null;
  plan.segmentTotal = null;
  plan.pricingMode = null;
  plan.adjustmentReason = '';
}
