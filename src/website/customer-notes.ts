import { EntityManager } from 'typeorm';
import { requireDictionaryItem } from '../common/dictionary-items';
import { BusinessException } from '../common/exceptions/business.exception';

export async function validateCustomerNotesLocations(
  manager: EntityManager,
  notes: { countryItemId: string | null; destinations: string[] },
) {
  if (notes.countryItemId)
    await requireDictionaryItem(manager, 'country-region', notes.countryItemId);
  if (!notes.destinations.length) return;
  const [row] = await manager.query<
    { config: { cities: { id: string; status: string }[] } }[]
  >(
    "SELECT v.config FROM website_config_versions v JOIN website_config_current c ON c.version=v.version AND c.business_unit=v.business_unit WHERE c.business_unit='website'",
  );
  const enabled = new Set(
    row?.config.cities
      .filter((city) => city.status === 'enabled')
      .map((city) => city.id),
  );
  if (notes.destinations.some((id) => !enabled.has(id)))
    throw new BusinessException({
      code: 'VALIDATION_ERROR',
      message: '请选择启用的独立站目的地城市',
      status: 400,
    });
}
