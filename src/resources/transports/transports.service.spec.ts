import { DataSource, Repository } from 'typeorm';
import { ResourceValidationService } from '../common/resource-validation.service';
import { TransportEntity } from './transport.entity';
import { TransportsService } from './transports.service';

describe('TransportsService', () => {
  it('applies the service-level filter before pagination', async () => {
    const builder = {
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    const repository = {
      createQueryBuilder: jest.fn().mockReturnValue(builder),
    } as unknown as Repository<TransportEntity>;
    const service = new TransportsService(
      repository,
      {} as ResourceValidationService,
      {} as DataSource,
    );

    await service.list({
      page: 1,
      pageSize: 20,
      serviceLevel: 'vip',
    });

    expect(builder.orderBy).toHaveBeenCalledWith('transport.createdAt', 'ASC');
    expect(builder.addOrderBy).toHaveBeenCalledWith('transport.id', 'ASC');
    expect(builder.andWhere).toHaveBeenCalledWith(
      'transport.serviceLevel = :serviceLevel',
      { serviceLevel: 'vip' },
    );
  });
});
