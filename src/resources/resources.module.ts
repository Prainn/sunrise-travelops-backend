import { SelectionController } from './selections/selection.controller';
import { SelectionService } from './selections/selection.service';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BusinessDictionaryItemEntity } from '../system/business-dictionaries/business-dictionary-item.entity';
import { BusinessDictionaryTypeEntity } from '../system/business-dictionaries/business-dictionary-type.entity';
import { AgenciesController } from './agencies/agencies.controller';
import { AgencyContactEntity, AgencyEntity } from './agencies/agency.entity';
import { AgenciesService } from './agencies/agencies.service';
import {
  AttractionEntity,
  AttractionPriceEntity,
} from './attractions/attraction.entity';
import { AttractionsController } from './attractions/attractions.controller';
import { AttractionsService } from './attractions/attractions.service';
import { ResourceValidationService } from './common/resource-validation.service';
import { GuideEntity } from './guides/guide.entity';
import { GuidesController } from './guides/guides.controller';
import { GuidesService } from './guides/guides.service';
import { HotelEntity } from './hotels/hotel.entity';
import { HotelsController } from './hotels/hotels.controller';
import { HotelsService } from './hotels/hotels.service';
import {
  RestaurantEntity,
  RestaurantPriceEntity,
} from './restaurants/restaurant.entity';
import { RestaurantsController } from './restaurants/restaurants.controller';
import { RestaurantsService } from './restaurants/restaurants.service';
import { TransportEntity } from './transports/transport.entity';
import { TransportsController } from './transports/transports.controller';
import { TransportsService } from './transports/transports.service';

import { CityEntity } from './cities/city.entity';
import { CitiesController } from './cities/cities.controller';
import { CitiesService } from './cities/cities.service';

const entities = [
  CityEntity,
  AgencyEntity,
  AgencyContactEntity,
  HotelEntity,
  RestaurantEntity,
  RestaurantPriceEntity,
  AttractionEntity,
  AttractionPriceEntity,
  TransportEntity,
  GuideEntity,
  BusinessDictionaryTypeEntity,
  BusinessDictionaryItemEntity,
];

@Module({
  imports: [TypeOrmModule.forFeature(entities)],
  controllers: [
    SelectionController,
    CitiesController,
    AgenciesController,
    HotelsController,
    RestaurantsController,
    AttractionsController,
    TransportsController,
    GuidesController,
  ],
  exports: [AgenciesService],
  providers: [
    SelectionService,
    CitiesService,
    ResourceValidationService,
    AgenciesService,
    HotelsService,
    RestaurantsService,
    AttractionsService,
    TransportsService,
    GuidesService,
  ],
})
export class ResourcesModule {}
