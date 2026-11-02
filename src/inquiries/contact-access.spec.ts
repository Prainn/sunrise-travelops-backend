import { DataSource, EntityManager } from 'typeorm';
import { effectivePermissions } from '../auth/identity-permissions';
import { AgenciesService } from '../resources/agencies/agencies.service';
import { ItineraryValidation } from './itinerary-validation';
import { InquiriesService } from './inquiries.service';
type Actor = Parameters<InquiriesService['createContact']>[2];

function setup(
  scope: Actor['scope'],
  businessUnit = 'shengxu',
  originalAgency = 'agency',
  visible = true,
) {
  const actor = {
    id: 'actor',
    scope,
    permissions: effectivePermissions(
      scope,
      scope === 'headquarters' ? ['ROOT'] : ['COORDINATOR'],
    ),
    admin: scope === 'headquarters',
  } as Actor;
  const query = {
    andWhere: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(
      visible
        ? {
            id: 'inquiry',
            status: 'planning',
            data: { agencyId: originalAgency },
          }
        : null,
    ),
  };
  const manager = {
    findOne: jest
      .fn()
      .mockResolvedValue({ id: 'agency', status: 'enabled', businessUnit }),
    createQueryBuilder: () => query,
  } as unknown as EntityManager;
  const db = {
    transaction: <T>(work: (manager: EntityManager) => Promise<T>) =>
      work(manager),
  } as DataSource;
  const createContact = jest.fn().mockResolvedValue({ id: 'contact' });
  const service = new InquiriesService(
    db,
    {} as ItineraryValidation,
    { createContact } as unknown as AgenciesService,
  );
  return { service, actor, createContact, manager, query };
}
describe('inquiry contact scope', () => {
  it.each(['linxi', 'website'] as const)(
    'rejects %s despite inquiry permissions',
    async (scope) => {
      const { service, actor, createContact } = setup(scope);
      await expect(
        service.createContact('agency', { name: 'test', phone: '' }, actor),
      ).rejects.toMatchObject({ status: 403 });
      expect(createContact).not.toHaveBeenCalled();
    },
  );
  it.each(['shengxu', 'headquarters'] as const)(
    'permits %s and shares the checked transaction',
    async (scope) => {
      const { service, actor, createContact, manager } = setup(scope);
      await service.createContact('agency', { name: 'test', phone: '' }, actor);
      expect(createContact).toHaveBeenCalledWith(
        'agency',
        { name: 'test', phone: '' },
        'actor',
        manager,
      );
    },
  );
  it('rejects a newly selected agency from another business', async () => {
    const { service, actor, createContact } = setup('shengxu', 'linxi');
    await expect(
      service.createContact('agency', { name: 'test', phone: '' }, actor),
    ).rejects.toMatchObject({ status: 400 });
    expect(createContact).not.toHaveBeenCalled();
  });
  it('preserves the original agency only through an accessible inquiry', async () => {
    const { service, actor, createContact } = setup('shengxu', 'linxi');
    await service.createContact(
      'agency',
      { name: 'test', phone: '', inquiryId: 'inquiry' },
      actor,
    );
    expect(createContact).toHaveBeenCalledTimes(1);
  });
  it.each([
    [false, 'agency', 404],
    [true, 'different', 400],
  ] as const)(
    'rejects inaccessible/mismatched historical context',
    async (visible, original, status) => {
      const { service, actor, createContact } = setup(
        'shengxu',
        'linxi',
        original,
        visible,
      );
      await expect(
        service.createContact(
          'agency',
          { name: 'test', phone: '', inquiryId: 'inquiry' },
          actor,
        ),
      ).rejects.toMatchObject({ status });
      expect(createContact).not.toHaveBeenCalled();
    },
  );
});
