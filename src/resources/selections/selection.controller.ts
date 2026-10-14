import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import {
  ApiCommonErrorResponses,
  ApiPaginatedResponse,
  ApiSuccessResponse,
} from '../../common/swagger/api-response.decorator';
import { SelectionService } from './selection.service';
import {
  SelectionQuery,
  PriceOptionResponse,
  ResourceOptionResponse,
  RestaurantResponse,
  AttractionResponse,
} from './selection.dto';
@ApiTags('Resources')
@ApiBearerAuth()
@ApiCommonErrorResponses()
@Controller('resources/selections')
export class SelectionController {
  constructor(private readonly service: SelectionService) {}
  @Get('agencies')
  @Permissions('resource:agency:list')
  @ApiPaginatedResponse(ResourceOptionResponse)
  agencies(@Query() query: SelectionQuery) {
    return this.service.resources('agencies', query);
  }
  @Get('hotels')
  @Permissions('resource:hotel:list')
  @ApiPaginatedResponse(ResourceOptionResponse)
  hotels(@Query() query: SelectionQuery) {
    return this.service.resources('hotels', query);
  }
  @Get('transports')
  @Permissions('resource:transport:list')
  @ApiPaginatedResponse(ResourceOptionResponse)
  transports(@Query() query: SelectionQuery) {
    return this.service.resources('transports', query);
  }
  @Get('guides')
  @Permissions('resource:guide:list')
  @ApiPaginatedResponse(ResourceOptionResponse)
  guides(@Query() query: SelectionQuery) {
    return this.service.resources('guides', query);
  }
  @Get('restaurants')
  @Permissions('resource:restaurant:list')
  @ApiPaginatedResponse(PriceOptionResponse)
  restaurants(@Query() query: SelectionQuery) {
    return this.service.list('restaurant', query);
  }
  @Get('restaurants/:id')
  @Permissions('resource:restaurant:list')
  @ApiSuccessResponse({ type: RestaurantResponse })
  restaurant(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.detail('restaurant', id);
  }
  @Get('attractions')
  @Permissions('resource:attraction:list')
  @ApiPaginatedResponse(PriceOptionResponse)
  attractions(@Query() query: SelectionQuery) {
    return this.service.list('attraction', query);
  }
  @Get('attractions/:id')
  @Permissions('resource:attraction:list')
  @ApiSuccessResponse({ type: AttractionResponse })
  attraction(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.detail('attraction', id);
  }
}
