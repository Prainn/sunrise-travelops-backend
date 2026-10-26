import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DataSource } from 'typeorm';
import { OperationLogEntity } from './operation-log.entity';
import {
  OperationLogQueryDto,
  OperationLogsController,
} from './operation-logs.controller';
import { OperationLogsService } from './operation-logs.service';

// Build real PostgreSQL queries without opening a database connection.
class QueryDataSource extends DataSource {
  prepare() {
    return this.buildMetadatas();
  }
}

describe('Operation log filters', () => {
  const db = new QueryDataSource({
    type: 'postgres',
    entities: [OperationLogEntity],
  });
  const repository = db.getRepository(OperationLogEntity);
  const service = new OperationLogsService(repository);
  const controller = new OperationLogsController(service);
  const findAndCount = jest.spyOn(repository, 'findAndCount');

  beforeAll(() => db.prepare());
  beforeEach(() => {
    findAndCount.mockReset();
    findAndCount.mockResolvedValue([[], 0]);
  });

  function querySql() {
    const options = findAndCount.mock.calls[0][0]!;
    return repository
      .createQueryBuilder('log')
      .setFindOptions(options)
      .getQueryAndParameters();
  }

  it('combines all filters in the database query before counting and paging', async () => {
    const query = plainToInstance(OperationLogQueryDto, {
      page: '2',
      pageSize: '10',
      category: 'login',
      scope: 'website',
      start: '2026-10-25',
      end: '2026-10-26',
      actorName: '  A%_\\lice  ',
    });
    expect(validateSync(query)).toEqual([]);
    expect(await controller.list(query)).toEqual({
      list: [],
      total: 0,
      page: 2,
      pageSize: 10,
    });
    const [sql, parameters] = querySql();
    expect(sql).toContain('"log"."category" = $1');
    expect(sql).toContain('"log"."scope" = $2');
    expect(sql).toContain('"log"."actor_name" ILIKE $3');
    expect(sql).toContain('"log"."time" >= $4::timestamptz');
    expect(sql).toContain(
      '"log"."time" < $5::timestamptz + interval \'24 hours\'',
    );
    expect(sql).toContain(
      'ORDER BY "log"."time" DESC, "log"."id" DESC LIMIT 10 OFFSET 10',
    );
    expect(parameters).toEqual([
      'login',
      'website',
      '%A\\%\\_\\\\lice%',
      '2026-10-25T00:00:00+08:00',
      '2026-10-26T00:00:00+08:00',
    ]);
  });

  it('allows a same-day range and uses an exclusive next-day boundary', async () => {
    await controller.list(
      plainToInstance(OperationLogQueryDto, {
        start: '2026-10-26',
        end: '2026-10-26',
      }),
    );
    const [sql, parameters] = querySql();
    expect(sql).toContain('"log"."time" >= $1::timestamptz');
    expect(sql).toContain(
      '"log"."time" < $2::timestamptz + interval \'24 hours\'',
    );
    expect(parameters).toEqual([
      '2026-10-26T00:00:00+08:00',
      '2026-10-26T00:00:00+08:00',
    ]);
  });

  it.each(['start', 'end'])(
    'supports an independent %s boundary',
    async (field) => {
      await controller.list(
        plainToInstance(OperationLogQueryDto, { [field]: '2026-10-26' }),
      );
      const [sql, parameters] = querySql();
      expect(sql).toContain(
        field === 'start' ? '"log"."time" >= $1' : '"log"."time" < $1',
      );
      expect(parameters).toEqual(['2026-10-26T00:00:00+08:00']);
    },
  );

  it('clears all conditions and ignores a whitespace-only operator', async () => {
    await controller.list(
      plainToInstance(OperationLogQueryDto, { actorName: '   ' }),
    );
    const [sql, parameters] = querySql();
    expect(sql).not.toContain('WHERE');
    expect(parameters).toEqual([]);
  });

  it('rejects reversed dates before accessing the repository', async () => {
    await expect(
      controller.list(
        plainToInstance(OperationLogQueryDto, {
          start: '2026-10-27',
          end: '2026-10-26',
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(findAndCount).not.toHaveBeenCalled();
  });

  it.each([
    { start: '2026-02-30' },
    { end: '2026-10-26T00:00:00Z' },
    { start: 'invalid' },
    { actorName: ['Alice'] },
    { actorName: 'a'.repeat(81) },
  ])('rejects invalid query input %j', (values) => {
    expect(
      validateSync(plainToInstance(OperationLogQueryDto, values)).length,
    ).toBeGreaterThan(0);
  });
});
