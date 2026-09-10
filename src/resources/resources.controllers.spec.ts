import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { CitiesController } from './cities/cities.controller';
import { AgenciesController } from './agencies/agencies.controller';
import { AttractionsController } from './attractions/attractions.controller';
import { GuidesController } from './guides/guides.controller';
import { HotelsController } from './hotels/hotels.controller';
import { RestaurantsController } from './restaurants/restaurants.controller';
import { TransportsController } from './transports/transports.controller';

describe('resource controller permissions', () => {
  it.each([
    [CitiesController, 'resource:city'],
    [AgenciesController, 'resource:agency'],
    [HotelsController, 'resource:hotel'],
    [RestaurantsController, 'resource:restaurant'],
    [AttractionsController, 'resource:attraction'],
    [TransportsController, 'resource:transport'],
    [GuidesController, 'resource:guide'],
  ])(
    'protects %p CRUD routes with existing permissions',
    (controller, prefix) => {
      expect(permission(controller, 'list')).toEqual([`${prefix}:list`]);
      expect(permission(controller, 'create')).toEqual([`${prefix}:create`]);
      expect(permission(controller, 'update')).toEqual([`${prefix}:update`]);
      expect(permission(controller, 'delete')).toEqual([`${prefix}:delete`]);
    },
  );

  it('makes child permissions follow their parent resource', () => {
    expect(permission(AgenciesController, 'listContacts')).toEqual([
      'resource:agency:list',
    ]);
    expect(permission(RestaurantsController, 'createPrice')).toEqual([
      'resource:restaurant:create',
    ]);
    expect(permission(AttractionsController, 'deletePrices')).toEqual([
      'resource:attraction:delete',
    ]);
  });
});

function permission(
  controller: { prototype: object },
  method: string,
): string[] | undefined {
  const prototype = controller.prototype as Record<string, object>;
  return Reflect.getMetadata(PERMISSIONS_KEY, prototype[method]) as
    string[] | undefined;
}
import 'reflect-metadata';
