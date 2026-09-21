import { EntityManager } from 'typeorm';
import { CurrentPdfData as PdfData } from './inquiry.entity';
export async function saveFrozenDetails(
  manager: EntityManager,
  id: string,
  snapshot: PdfData,
) {
  const calculation = snapshot.calculation;
  if (!('pricingVersion' in calculation) || calculation.pricingVersion !== 2)
    throw new Error('Only PAX quotes can be newly frozen');
  await manager.query(
    'UPDATE itinerary_quotes SET quote_code=$2,quote_version=$3,inquiry_id=$4,inquiry_version=$5,daily_resource_cost=$6,guide_cost=$7 WHERE id=$1',
    [
      id,
      snapshot.quoteCode,
      snapshot.quoteVersion,
      snapshot.inquiry.id,
      snapshot.inquiryVersion,
      calculation.dailyResourceCost,
      calculation.guideCost,
    ],
  );
  for (const [position, option] of calculation.options.entries()) {
    await manager.query(
      `INSERT INTO quote_options(quote_id,option_id,position,hotel_tier,vehicle_tier,hotel_unit_cost,vehicle_total,guide_service_total,staff_room_total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        option.optionId,
        position,
        option.hotelTier,
        option.vehicleTier,
        option.hotelUnitCost,
        option.vehicleTotal,
        option.guideServiceTotal,
        option.staffRoomTotal,
      ],
    );
    for (const [order, price] of option.paxPrices.entries()) {
      await manager.query(
        `INSERT INTO quote_pax_prices(quote_id,option_id,position,pax,vehicle_unit_cost,guide_service_unit_cost,staff_room_unit_cost,base_cost_per_person,adult_unit_price,child_unit_price,leader_unit_price,single_supplement_unit_cost,tip_unit_price,profit_per_person,actual_margin_rate)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          id,
          option.optionId,
          order,
          price.pax,
          price.vehicleUnitCost,
          price.guideServiceUnitCost,
          price.staffRoomUnitCost,
          price.baseCostPerPerson,
          price.adultUnitPrice,
          price.childUnitPrice,
          price.leaderUnitPrice,
          price.singleSupplementUnitCost,
          price.tipUnitPrice,
          price.profitPerPerson,
          price.actualMarginRate,
        ],
      );
    }
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
        dinerCount: i.dinerCount,
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
        dinerCount: null,
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
      dinerCount: null,
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
      dinerCount: null,
      price: v.totalPrice,
      total: v.totalPrice,
      day: null,
      tier: v.tier,
    })),
  ];
  for (const [position, item] of items.entries())
    await manager.query(
      'INSERT INTO quote_resource_lines(quote_id,position,item_key,type,name,resource_id,price_id,unit,quantity,unit_price,total_price,day_number,tier,destination,reference_price,reference_basis,adjustment_reason,diner_count) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
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
        item.dinerCount,
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
    ...(['chineseTip', 'englishTip'] as const).map((key) => ({
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
