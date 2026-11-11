import type { AuthenticatedUser } from './auth.types';

/** Menu switches only subtract existing account permissions; they never grant new roles/actions. */
export function sunrisePermissions(permissions: string[], menuKeys: string[]) {
  const has = (...keys: string[]) => keys.some((key) => menuKeys.includes(key));
  const families: [string, string[]][] = [
    ['whatsapp:integration:', ['whatsapp-integration']],
    ['whatsapp:quick-reply:', ['whatsapp-quick-replies']],
    ['whatsapp:', ['whatsapp-inbox']],
    ['sys:menu-permission:', ['menu-permissions']],
    ['sys:account-link:', ['account-links']],
    ['sys:business-dictionary:', ['business-dict']],
    ['sys:business-group:', ['business-groups']],
    ['sys:dict', ['dict']],
    ['sys:user:', ['users']],
    ['sys:operation-log:', ['operations']],
    ['resource:agency:', ['agency']],
    ['resource:city:', ['city']],
    ['resource:hotel:', ['hotel']],
    ['resource:restaurant:', ['restaurant']],
    ['resource:attraction:', ['attraction']],
    ['resource:transport:', ['transport']],
    ['resource:flight:', ['flight']],
    ['resource:guide:', ['guide-people', 'guide-leaves']],
    ['tour:rating:', ['guide-ratings']],
    ['tour:', ['tours']],
    ['website:config:', ['website-config']],
    ['website:visit:', ['website-visits']],
    ['website:inquiry:', ['inquiries']],
    ['website:itinerary:', ['inquiries']],
    ['inquiry:', ['inquiries']],
    ['itinerary:', ['inquiries']],
    ['ledger:shengxu:', ['shengxu-ledger']],
    ['ledger:direct:', ['direct-ledger', 'website-ledger']],
  ];
  return permissions.filter((permission) => {
    if (permission === 'inquiry:list')
      return has('inquiries', 'inquiry-summary');
    if (permission === 'website:inquiry:list')
      return has('inquiries', 'website-inquiry-summary');
    if (permission === 'ledger:summary:list')
      return has(
        'shengxu-agency-summary',
        'shengxu-coordinator-summary',
        'linxi-quote-summary',
        'linxi-platform-summary',
        'website-quote-summary',
        'website-platform-summary',
      );
    const family = families.find(([prefix]) => permission.startsWith(prefix));
    return family ? has(...family[1]) : false;
  });
}

/** Shared read permissions do not let a disabled page's HTTP handlers bypass its switch. */
export function hasSunriseHandlerAccess(
  user: AuthenticatedUser,
  controller: string,
  handler: string,
) {
  if (user.username !== 'sunrise') return true;
  const pages: Record<string, string[]> = {
    WebsiteController: [
      'inquiryLogs',
      'inquiryLogReport',
      'inquiryLogOperators',
    ].includes(handler)
      ? handler === 'inquiryLogs'
        ? ['inquiries', 'website-inquiry-summary']
        : ['website-inquiry-summary']
      : ['list', 'owners', 'detail', 'itineraries'].includes(handler)
        ? ['inquiries']
        : [],
    InquiriesController: ['inquiries'],
    ItinerariesController: ['inquiries'],
    InquiryLogsController:
      handler === 'report' || handler === 'operators'
        ? ['inquiry-summary']
        : ['inquiries', 'inquiry-summary'],
    GuideLeavesController: ['guide-leaves'],
    GuidePeopleController: ['guide-people'],
    GuidesController: ['guide-people'],
  };
  return (
    !pages[controller]?.length ||
    pages[controller].some((key) => user.menuKeys.includes(key))
  );
}
