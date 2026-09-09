import { Injectable, HttpStatus } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/constants/error-code';
import { auditResponse } from '../common/resource.dto';
import { AgencyEntity } from '../agencies/agency.entity';
import { HotelEntity } from '../hotels/hotel.entity';
import { GuideEntity } from '../guides/guide.entity';
import { TransportEntity } from '../transports/transport.entity';
import { RestaurantPriceEntity } from '../restaurants/restaurant.entity';
import { AttractionPriceEntity } from '../attractions/attraction.entity';
import {
  SelectionQuery,
  PriceOptionResponse,
  ResourceOptionResponse,
} from './selection.dto';
type Kind = 'restaurant' | 'attraction';
@Injectable()
export class SelectionService {
  constructor(private readonly dataSource: DataSource) {}
  private query(kind: Kind) {
    const entity =
      kind === 'restaurant' ? RestaurantPriceEntity : AttractionPriceEntity;
    return this.dataSource
      .getRepository(entity)
      .createQueryBuilder('price')
      .innerJoin(`price.${kind}`, 'resource')
      .where('resource.status = :status', { status: 'enabled' })
      .andWhere('resource.deletedAt IS NULL');
  }
  async list(kind: Kind, query: SelectionQuery) {
    const city = kind === 'restaurant' ? 'city' : 'area';
    const name = kind === 'restaurant' ? 'menuName' : 'itemName';
    const amount = kind === 'restaurant' ? 'price' : 'settlementPrice';
    const qb = this.query(kind);
    if (query.city?.trim())
      qb.andWhere(`resource.${city} = :city`, { city: query.city.trim() });
    if (query.keyword?.trim())
      qb.andWhere(
        `(resource.name ILIKE :keyword OR price.${name} ILIKE :keyword)`,
        { keyword: `%${query.keyword.trim()}%` },
      );
    const total = await qb.getCount();
    const list = await qb
      .select('price.id', 'id')
      .addSelect('resource.id', 'resourceId')
      .addSelect('resource.name', 'resourceName')
      .addSelect(`resource.${city}`, 'city')
      .addSelect(
        kind === 'restaurant'
          ? 'price.menuName'
          : "concat_ws(' · ', price.itemName, NULLIF(price.audience, ''), NULLIF(price.periodName, ''))",
        'priceName',
      )
      .addSelect('price.unit', 'unit')
      .addSelect(`price.${amount}`, 'unitCost')
      .orderBy('resource.name', 'ASC')
      .addOrderBy('price.id', 'ASC')
      .offset((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .getRawMany<PriceOptionResponse>();
    return { list, total, page: query.page, pageSize: query.pageSize };
  }
  async resources(
    kind: 'hotels' | 'transports' | 'guides' | 'agencies',
    query: SelectionQuery,
  ) {
    const entity = {
      agencies: AgencyEntity,
      hotels: HotelEntity,
      transports: TransportEntity,
      guides: GuideEntity,
    }[kind];
    const qb = this.dataSource
      .getRepository(entity)
      .createQueryBuilder('resource')
      .where('resource.status = :status', { status: 'enabled' });
    if (query.keyword?.trim())
      qb.andWhere('resource.name ILIKE :keyword', {
        keyword: `%${query.keyword.trim()}%`,
      });
    if (['hotels', 'agencies'].includes(kind) && query.city?.trim())
      qb.andWhere('resource.city = :city', { city: query.city.trim() });
    if (kind === 'hotels' && query.rating)
      qb.andWhere('resource.rating = :rating', { rating: query.rating });
    if (kind === 'transports') {
      if (query.serviceLevel)
        qb.andWhere('resource.serviceLevel = :level', {
          level: query.serviceLevel,
        });
    }
    if (kind === 'guides') {
      if (query.secondLanguage)
        qb.andWhere('resource.secondLanguage = :language', {
          language: query.secondLanguage,
        });
      if (query.shopping)
        qb.andWhere('resource.shopping = :shopping', {
          shopping: query.shopping === 'true',
        });
    }
    if (kind === 'agencies' && query.code)
      qb.andWhere('resource.code = :code', { code: query.code });
    const total = await qb.getCount();
    qb.select('resource.id', 'id').addSelect('resource.name', 'name');
    if (kind === 'hotels') {
      qb.addSelect(
        'CASE WHEN resource.groupPrice IS NOT NULL AND resource.minimumGroupSize IS NOT NULL AND resource.minimumGroupSize <= :guests THEN resource.groupPrice ELSE resource.individualPrice END',
        'unitCost',
      ).setParameter('guests', query.guestCount ?? 0);
    } else if (kind === 'agencies') qb.addSelect('resource.code', 'code');
    else if (kind === 'guides')
      qb.addSelect('resource.dailyPrice', 'unitCost')
        .addSelect('resource.secondLanguage', 'secondLanguage')
        .addSelect('resource.shopping', 'shopping');
    if (kind === 'transports') qb.addSelect('resource.seats', 'seats');
    const list = await qb
      .orderBy('resource.name', 'ASC')
      .addOrderBy('resource.id', 'ASC')
      .offset((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .getRawMany<ResourceOptionResponse>();
    return { list, total, page: query.page, pageSize: query.pageSize };
  }
  async detail(kind: Kind, id: string) {
    const row = await this.query(kind)
      .addSelect('resource')
      .andWhere('price.id = :id', { id })
      .getOne();
    if (!row)
      throw new BusinessException({
        code:
          kind === 'restaurant'
            ? ErrorCode.RESTAURANT_PRICE_NOT_FOUND
            : ErrorCode.ATTRACTION_PRICE_NOT_FOUND,
        message: 'Resource price not found',
        status: HttpStatus.NOT_FOUND,
      });
    if (row instanceof RestaurantPriceEntity) {
      const { restaurant, ...price } = row;
      const resource = { ...restaurant, deletedAt: undefined };
      const selectedPrice = { ...price, deletedAt: undefined };
      return {
        resource: { ...resource, ...auditResponse(restaurant) },
        price: { ...selectedPrice, ...auditResponse(row) },
      };
    }
    const { attraction, ...price } = row as AttractionPriceEntity;
    const resource = { ...attraction, deletedAt: undefined };
    const selectedPrice = { ...price, deletedAt: undefined };
    return {
      resource: { ...resource, ...auditResponse(attraction) },
      price: { ...selectedPrice, ...auditResponse(row) },
    };
  }
}
