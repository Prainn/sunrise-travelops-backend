import { HttpStatus } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import { ErrorCode } from '../common/constants/error-code';
import { BusinessException } from '../common/exceptions/business.exception';
import { quotationPriceKey } from './website-price';
import type {
  WebsiteDay,
  WebsiteItineraryInput,
  WebsiteVehiclePriceInput,
} from './website.types';

/** Only seat designations have a business code. 38 is a confirmed historical shorthand. */
export function vehicleWithSeatCode<T extends { vehicleType?: string | null }>(
  row: T,
): T {
  const value = row.vehicleType;
  if (!value) return row;
  const seats =
    /^seat([1-9]\d*)$/.exec(value)?.[1] ??
    /^([1-9]\d*)(?:座|-seat vehicle)$/.exec(value)?.[1] ??
    (value === '38' ? value : undefined);
  return seats ? { ...row, vehicleType: `${seats}_seat` } : row;
}

function dayWithSeatCodes(day: WebsiteDay): WebsiteDay {
  return { ...day, legs: day.legs.map(vehicleWithSeatCode) };
}

/** Frozen quotes can contain both an old label and a code for the same offer. */
function copyPrices(
  rows: WebsiteVehiclePriceInput[],
): WebsiteVehiclePriceInput[] {
  const unique = new Map<string, WebsiteVehiclePriceInput>();
  for (const row of rows) {
    const price = vehicleWithSeatCode(row);
    const key = quotationPriceKey(price);
    const existing = unique.get(key);
    if (existing) {
      const byCategory = (p: WebsiteVehiclePriceInput) =>
        [...(p.priceComponents ?? [])].sort((a, b) =>
          a.category.localeCompare(b.category),
        );
      if (
        existing.unitPrice !== price.unitPrice ||
        !isDeepStrictEqual(byCategory(existing), byCategory(price))
      )
        throw new BusinessException({
          code: ErrorCode.ITINERARY_INVALID,
          status: HttpStatus.BAD_REQUEST,
          message: `旧车型归并为 ${price.vehicleType} 后有不同的报价明细，无法直接复制`,
        });
    } else {
      unique.set(key, price);
    }
  }
  return [...unique.values()];
}

export function planWithSeatCodes(
  input: WebsiteItineraryInput,
  fromCopy = false,
): WebsiteItineraryInput {
  const prices = (rows: WebsiteVehiclePriceInput[]) =>
    fromCopy ? copyPrices(rows) : rows.map(vehicleWithSeatCode);
  return {
    ...input,
    days: input.days.map(dayWithSeatCodes),
    deletedDays: input.deletedDays?.map((entry) => ({
      ...entry,
      day: dayWithSeatCodes(entry.day),
    })),
    reorderDraft: input.reorderDraft && {
      ...input.reorderDraft,
      transportCopies:
        input.reorderDraft.transportCopies?.map(vehicleWithSeatCode),
    },
    vehiclePrices: prices(input.vehiclePrices),
    nightlyVehiclePrices:
      input.nightlyVehiclePrices && prices(input.nightlyVehiclePrices),
  };
}
