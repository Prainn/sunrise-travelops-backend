import { EntityManager } from 'typeorm';
import { PdfData } from './inquiry.entity';
export async function saveFrozenDetails(
  manager: EntityManager,
  id: string,
  snapshot: PdfData,
) {
  const calculation = snapshot.calculation;
  await manager.query(
    'UPDATE itinerary_quotes SET quote_code=$2,quote_version=$3,inquiry_id=$4,inquiry_version=$5,hotel_guest_count=$6,hotel_room_count=$7,daily_resource_cost=$8,guide_cost=$9 WHERE id=$1',
    [
      id,
      snapshot.quoteCode,
      snapshot.quoteVersion,
      snapshot.inquiry.id,
      snapshot.inquiryVersion,
      calculation.hotelGuestCount,
      calculation.hotelRoomCount,
      calculation.dailyResourceCost,
      calculation.guideCost,
    ],
  );
  for (const [position, option] of calculation.options.entries()) {
    await manager.query(
      `INSERT INTO quote_options(quote_id,option_id,position,hotel_tier,vehicle_tier,hotel_cost,vehicle_cost,common_group_cost,base_group_cost,base_cost_per_person,single_supplement_unit_cost,adult_unit_price,child_unit_price,total_price,expected_profit,margin_rate,leader_foc_enabled) VALUES (${Array.from({ length: 17 }, (_, i) => `$${i + 1}`).join(',')})`,
      [
        id,
        option.optionId,
        position,
        option.hotelTier,
        option.vehicleTier,
        option.hotelCost,
        option.vehicleCost,
        option.commonGroupCost,
        option.baseGroupCost,
        option.baseCostPerPerson,
        option.singleSupplementUnitCost,
        option.adultUnitPrice,
        option.childUnitPrice,
        option.totalPrice,
        option.profit,
        option.actualMarginRate,
        snapshot.itinerary.quote.options.find((o) => o.id === option.optionId)!
          .leaderFocEnabled,
      ],
    );
    for (const [order, line] of option.lines.entries())
      await manager.query(
        'INSERT INTO quote_lines(quote_id,option_id,position,type,quantity,unit_price,total_price) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [
          id,
          option.optionId,
          order,
          line.type,
          line.quantity,
          line.unitPrice,
          line.totalPrice,
        ],
      );
  }
  const plan = snapshot.itinerary;
  const items = [
    ...plan.dailyPlans.flatMap((d) =>
      d.items.map((i) => ({
        key: i.id,
        destination: d.destination,
        referencePrice: i.referencePrice,
        referenceBasis: i.referenceBasis,
        adjustmentReason: i.adjustmentReason,
        type: i.type,
        name: i.resourceName,
        resourceId: i.resourceId,
        priceId: i.resourcePriceId,
        unit: i.unit,
        quantity: i.quantity,
        price: i.unitCost,
        total: i.totalCost,
        day: d.dayNumber,
        tier: null,
      })),
    ),
    ...plan.hotelPlans.flatMap((p) =>
      p.hotels.map((h) => ({
        key: `${p.tier}:${h.destination}`,
        destination: h.destination,
        referencePrice: h.referencePrice,
        referenceBasis: h.referenceBasis,
        adjustmentReason: h.adjustmentReason,
        type: 'hotel',
        name: h.hotelName,
        resourceId: h.hotelId,
        priceId: null,
        unit: h.unit,
        quantity: null,
        price: h.unitCost,
        total: null,
        day: null,
        tier: p.tier,
      })),
    ),
    ...plan.guidePlans.map((g) => ({
      key: g.guideId,
      destination: g.destination,
      referencePrice: g.referencePrice,
      referenceBasis: g.referenceBasis,
      adjustmentReason: g.adjustmentReason,
      type: 'guide',
      name: g.guideName,
      resourceId: g.guideId,
      priceId: null,
      unit: 'day',
      quantity: g.serviceDays,
      price: g.dailyPrice,
      total: null,
      day: null,
      tier: null,
    })),
    ...plan.vehiclePlans.map((v) => ({
      key: v.tier,
      destination: null,
      referencePrice: v.segmentTotal,
      referenceBasis: v.segmentTotal == null ? null : 'segment_total',
      adjustmentReason: v.adjustmentReason,
      type: 'vehicle',
      name: v.tier,
      resourceId: null,
      priceId: null,
      unit: 'trip',
      quantity: 1,
      price: v.totalPrice,
      total: v.totalPrice,
      day: null,
      tier: v.tier,
    })),
  ];
  for (const [position, item] of items.entries())
    await manager.query(
      'INSERT INTO quote_resource_lines(quote_id,position,item_key,type,name,resource_id,price_id,unit,quantity,unit_price,total_price,day_number,tier,destination,reference_price,reference_basis,adjustment_reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)',
      [
        id,
        position,
        item.key,
        item.type,
        item.name,
        item.resourceId,
        item.priceId,
        item.unit,
        item.quantity,
        item.price,
        item.total,
        item.day,
        item.tier,
        item.destination,
        item.referencePrice ?? null,
        item.referenceBasis ?? null,
        item.adjustmentReason ?? null,
      ],
    );
  for (const vehicle of plan.vehiclePlans)
    for (const [position, range] of vehicle.arrangements.entries()) {
      await manager.query(
        'INSERT INTO quote_vehicle_ranges(quote_id,tier,range_id,position,start_date,end_date,total_price) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          id,
          vehicle.tier,
          range.id,
          position,
          range.startDate,
          range.endDate,
          range.totalPrice ?? null,
        ],
      );
      for (const [order, selection] of range.vehicles.entries())
        await manager.query(
          'INSERT INTO quote_vehicles(quote_id,tier,range_id,position,vehicle_id,vehicle_name,seats,quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            id,
            vehicle.tier,
            range.id,
            order,
            selection.vehicleId,
            selection.vehicleName,
            selection.seats,
            selection.quantity,
          ],
        );
    }
  const extras = [
    ...plan.quote.transportFees.map((f) => ({
      id: f.id,
      type: f.type,
      price: f.unitPrice,
      departure: f.departureCity,
      arrival: f.arrivalCity,
      cabin: f.cabin,
    })),
    ...(['chineseTip', 'englishTip', 'otherExpenses'] as const).map((key) => ({
      id: key,
      type: key,
      price: plan.quote[key],
      departure: null,
      arrival: null,
      cabin: null,
    })),
  ];
  for (const [position, extra] of extras.entries())
    await manager.query(
      'INSERT INTO quote_extra_fees(quote_id,position,item_key,type,amount,departure_city,arrival_city,cabin) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        id,
        position,
        extra.id,
        extra.type,
        extra.price,
        extra.departure,
        extra.arrival,
        extra.cabin,
      ],
    );
}
