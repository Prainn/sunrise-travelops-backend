import { DataSource, EntityManager, Repository } from 'typeorm';
import { AgencyContactEntity, AgencyEntity } from './agency.entity';
import { AgenciesService } from './agencies.service';

describe('AgenciesService contacts', () => {
  it('rejects a case-insensitive duplicate contact in one agency', async () => {
    const parentRepository = {
      findOneBy: jest.fn().mockResolvedValue({ id: 'agency' }),
    } as unknown as Repository<AgencyEntity>;
    const findOneContact = jest.fn().mockResolvedValue({ id: 'existing' });
    const contactRepository = {
      findOne: findOneContact,
    } as unknown as Repository<AgencyContactEntity>;
    const manager = {
      getRepository: jest.fn((entity: unknown) =>
        entity === AgencyEntity ? parentRepository : contactRepository,
      ),
    } as unknown as EntityManager;
    const dataSource = {
      transaction: jest.fn((callback: (manager: EntityManager) => unknown) =>
        callback(manager),
      ),
    } as unknown as DataSource;
    const service = new AgenciesService(
      {} as Repository<AgencyEntity>,
      {} as Repository<AgencyContactEntity>,
      dataSource,
    );
    await expect(
      service.createContact('agency', { name: 'ALICE', phone: '' }, 'actor'),
    ).rejects.toMatchObject({ code: 'AGENCY_CONTACT_NAME_EXISTS' });
    expect(findOneContact).toHaveBeenCalledWith({
      where: { agencyId: 'agency', nameKey: 'alice' },
    });
  });

  it('does not update a contact through another agency URL', async () => {
    const parentRepository = {
      findOneBy: jest.fn().mockResolvedValue({ id: 'agency-two' }),
    } as unknown as Repository<AgencyEntity>;
    const contactRepository = {
      findOne: jest.fn().mockResolvedValue(null),
    } as unknown as Repository<AgencyContactEntity>;
    const manager = {
      getRepository: jest.fn((entity: unknown) =>
        entity === AgencyEntity ? parentRepository : contactRepository,
      ),
    } as unknown as EntityManager;
    const dataSource = {
      transaction: jest.fn((callback: (manager: EntityManager) => unknown) =>
        callback(manager),
      ),
    } as unknown as DataSource;
    const service = new AgenciesService(
      {} as Repository<AgencyEntity>,
      {} as Repository<AgencyContactEntity>,
      dataSource,
    );
    await expect(
      service.updateContact(
        'agency-two',
        'contact',
        { name: 'Alice', phone: '', version: 1 },
        'actor',
      ),
    ).rejects.toMatchObject({ code: 'AGENCY_CONTACT_NOT_FOUND' });
  });
});
