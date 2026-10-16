/** Disposable localhost PostgreSQL only. Never loads application env files. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { DataSource } from 'typeorm';
import { AttractionEntity } from '../src/resources/attractions/attraction.entity';
import { RestaurantEntity } from '../src/resources/restaurants/restaurant.entity';
import { SelectionService } from '../src/resources/selections/selection.service';
import { ResourceStatus } from '../src/resources/common/resource.constants';

const connection = {
  type: 'postgres' as const,
  host: '127.0.0.1',
  port: 55439,
  username: 'postgres',
  password: 'isolated-test-only',
};
const database = `attraction_selection_${Date.now()}`;

async function run() {
  const admin = await new DataSource({
    ...connection,
    database: 'postgres',
  }).initialize();
  let db: DataSource | undefined;
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    db = await new DataSource({
      ...connection,
      database,
      entities: [AttractionEntity, RestaurantEntity],
      synchronize: true,
    }).initialize();
    const attractions = db.getRepository(AttractionEntity);
    for (const [index, fixture] of [
      { name: '空描述免费', description: '', price: '0.00' },
      { name: '空白描述', description: ' \t\n　', price: '10.00' },
      { name: '待补价', description: '', price: null },
      {
        name: '停用',
        description: '',
        price: '0.00',
        status: ResourceStatus.Disabled,
      },
      { name: '已删除', description: '', price: '0.00', deletedAt: new Date() },
    ].entries())
      await attractions.save(
        attractions.create({
          code: `ATT-${index + 1}`,
          area: '杭州',
          unit: 'personVisit',
          status: ResourceStatus.Enabled,
          ...fixture,
        }),
      );
    const restaurants = db.getRepository(RestaurantEntity);
    await restaurants.save(
      restaurants.create({
        code: 'RES-001',
        name: '空描述餐厅',
        city: '杭州',
        description: '',
        price: '0.00',
        unit: 'personMeal',
        status: ResourceStatus.Enabled,
      }),
    );
    const selection = new SelectionService(db);
    const query = { page: 1, pageSize: 20, city: '杭州' };
    const result = await selection.list('attraction', query);
    assert.equal(result.total, 2);
    assert.deepEqual(
      result.list.map((r) => r.resourceName).sort(),
      ['空描述免费', '空白描述'].sort(),
    );
    for (const row of result.list) {
      const detail = await selection.detail('attraction', row.id);
      assert.equal(detail.description.trim(), '');
      assert.equal(detail.price, row.unitCost);
    }
    assert.equal(
      (await selection.list('attraction', { ...query, keyword: '免费' })).total,
      1,
    );
    assert.equal(
      (await selection.list('attraction', { ...query, city: '昆明' })).total,
      0,
    );
    assert.equal((await selection.list('restaurant', query)).total, 0);
    for (const row of await attractions.find({ withDeleted: true }))
      if (!result.list.some((item) => item.id === row.id))
        await assert.rejects(selection.detail('attraction', row.id));
    const restaurant = (await restaurants.find())[0];
    await assert.rejects(selection.detail('restaurant', restaurant.id));
    console.log(
      'PASS: blank/whitespace attraction descriptions, zero price, list/detail/search/city; unpriced/disabled/deleted excluded; restaurant rule preserved.',
    );
  } finally {
    if (db?.isInitialized) await db.destroy();
    await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
    await admin.destroy();
  }
}
void run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
