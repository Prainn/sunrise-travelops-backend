import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Attractions and restaurants become single-level records with one price each.
 * Every live legacy price row becomes one record (the first live child reuses the
 * parent id so website references stay valid); old item details move into remark.
 * Parents without a live price keep price NULL ("to be priced") instead of 0.
 * Frozen quote tables and snapshots are untouched.
 */
export class FlattenAttractionAndRestaurantResources1791964800000 implements MigrationInterface {
  name = 'FlattenAttractionAndRestaurantResources1791964800000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `LOCK TABLE resource_attractions, resource_restaurants, resource_attraction_prices, resource_restaurant_prices, itinerary_items IN SHARE ROW EXCLUSIVE MODE`,
    );
    await q.query(`
      ALTER TABLE resource_attractions ADD COLUMN price numeric(12,2), ALTER COLUMN category DROP NOT NULL;
      ALTER TABLE resource_attractions ADD CONSTRAINT "CHK_resource_attractions_price" CHECK (price IS NULL OR price >= 0);
      ALTER TABLE resource_restaurants ADD COLUMN price numeric(12,2), ADD COLUMN diner_count integer;
      ALTER TABLE resource_restaurants ADD CONSTRAINT "CHK_resource_restaurants_price" CHECK (price IS NULL OR price >= 0);
      ALTER TABLE resource_restaurants ADD CONSTRAINT "CHK_resource_restaurants_diner_count" CHECK (diner_count IS NULL OR diner_count > 0);
      DROP INDEX IF EXISTS "UQ_resource_attractions_standard_city";
      DROP INDEX IF EXISTS "UQ_resource_restaurants_standard_city";
      CREATE TEMP TABLE flatten_map(old_price_id uuid, new_id uuid, parent_id uuid) ON COMMIT DROP;
    `);

    await q.query(`
      DO $$ DECLARE r record; target uuid; nm text; rm text; amount numeric; legacy text;
      BEGIN
        FOR r IN
          SELECT p.id AS price_id, p.attraction_id, p.item_type, p.item_name, p.audience, p.period_name,
                 p.start_date, p.end_date, p.rack_price, p.settlement_price, p.unit AS price_unit, p.is_free,
                 p.price_note, p.deleted_at AS price_deleted,
                 a.code AS parent_code, a.name AS parent_name, a.area, a.category, a.restroom_location,
                 a.remark AS parent_remark, a.status, a.created_at, a.created_by, a.updated_by,
                 a.deleted_at AS parent_deleted, a.description, a.is_standard_price,
                 row_number() OVER (PARTITION BY p.attraction_id ORDER BY (p.deleted_at IS NOT NULL), p.created_at, p.id) AS n,
                 count(*) OVER (PARTITION BY p.attraction_id, p.item_name) AS same_name
          FROM resource_attraction_prices p JOIN resource_attractions a ON a.id = p.attraction_id
          ORDER BY a.code, n
        LOOP
          nm := CASE WHEN btrim(r.item_name) = '' OR r.item_name = r.parent_name THEN r.parent_name
                     ELSE r.parent_name || '－' || r.item_name END;
          IF r.same_name > 1 AND (r.audience <> '' OR r.period_name <> '') THEN
            nm := nm || '（' || concat_ws(' ', nullif(r.audience, ''), nullif(r.period_name, '')) || '）';
          END IF;
          nm := left(nm, 150);
          amount := CASE WHEN r.is_free THEN 0 ELSE r.settlement_price END;
          legacy := concat_ws('；',
            '项目类型：' || r.item_type,
            CASE WHEN r.audience <> '' THEN '人群：' || r.audience END,
            CASE WHEN r.period_name <> '' THEN '时段：' || r.period_name END,
            CASE WHEN r.start_date IS NOT NULL OR r.end_date IS NOT NULL
              THEN '有效期：' || coalesce(r.start_date::text, '') || '~' || coalesce(r.end_date::text, '') END,
            '票面价：' || r.rack_price,
            CASE WHEN r.is_free THEN '免费' END,
            CASE WHEN r.price_note <> '' THEN '价格备注：' || r.price_note END);
          rm := concat_ws(E'\\n', nullif(r.parent_remark, ''), '[原价格项] ' || legacy);
          IF r.n = 1 AND r.price_deleted IS NULL THEN
            target := r.attraction_id;
            UPDATE resource_attractions SET name = nm, unit = r.price_unit, price = amount, remark = rm,
              version = version + 1, updated_at = now() WHERE id = target;
          ELSE
            target := gen_random_uuid();
            INSERT INTO resource_attractions (id, code, name, area, category, restroom_location, remark, unit, status,
              version, created_at, created_by, updated_at, updated_by, deleted_at, description, is_standard_price, price)
            VALUES (target, next_business_code('ATT'), nm, r.area, r.category, r.restroom_location, rm, r.price_unit,
              r.status, 1, r.created_at, r.created_by, now(), r.updated_by,
              coalesce(r.price_deleted, r.parent_deleted), r.description, r.is_standard_price, amount);
          END IF;
          INSERT INTO flatten_map VALUES (r.price_id, target, r.attraction_id);
        END LOOP;
      END $$;
    `);

    await q.query(`
      DO $$ DECLARE r record; target uuid; nm text; rm text; descr text;
      BEGIN
        FOR r IN
          SELECT p.id AS price_id, p.restaurant_id, p.menu_name, p.dish_details, p.unit AS price_unit, p.price,
                 p.diner_count, p.remark AS price_remark, p.deleted_at AS price_deleted,
                 a.name AS parent_name, a.city, a.cuisine, a.contact, a.phone, a.address,
                 a.remark AS parent_remark, a.status, a.created_at, a.created_by, a.updated_by,
                 a.deleted_at AS parent_deleted, a.description, a.is_standard_price,
                 row_number() OVER (PARTITION BY p.restaurant_id ORDER BY (p.deleted_at IS NOT NULL), p.created_at, p.id) AS n
          FROM resource_restaurant_prices p JOIN resource_restaurants a ON a.id = p.restaurant_id
          ORDER BY a.code, n
        LOOP
          nm := left(CASE WHEN btrim(r.menu_name) = '' OR r.menu_name = r.parent_name THEN r.parent_name
                          ELSE r.parent_name || '－' || r.menu_name END, 150);
          descr := concat_ws(E'\\n', nullif(r.description, ''), nullif(r.dish_details, ''));
          rm := concat_ws(E'\\n', nullif(r.parent_remark, ''), nullif(r.price_remark, ''));
          IF r.n = 1 AND r.price_deleted IS NULL THEN
            target := r.restaurant_id;
            UPDATE resource_restaurants SET name = nm, unit = r.price_unit, price = r.price, description = descr,
              remark = rm, diner_count = CASE WHEN r.price_unit = 'table' THEN r.diner_count END,
              version = version + 1, updated_at = now() WHERE id = target;
          ELSE
            target := gen_random_uuid();
            INSERT INTO resource_restaurants (id, code, name, city, cuisine, contact, phone, address, remark, unit, status,
              version, created_at, created_by, updated_at, updated_by, deleted_at, description, is_standard_price, price, diner_count)
            VALUES (target, next_business_code('RES'), nm, r.city, r.cuisine, r.contact, r.phone, r.address, rm,
              r.price_unit, r.status, 1, r.created_at, r.created_by, now(), r.updated_by,
              coalesce(r.price_deleted, r.parent_deleted), descr, r.is_standard_price, r.price,
              CASE WHEN r.price_unit = 'table' THEN r.diner_count END);
          END IF;
          INSERT INTO flatten_map VALUES (r.price_id, target, r.restaurant_id);
        END LOOP;
      END $$;
    `);

    // Draft itineraries point at the new single-level record; reference and actual prices stay as saved.
    await q.query(`
      UPDATE itinerary_items i SET resource_id = m.new_id
      FROM flatten_map m
      WHERE i.resource_price_id = m.old_price_id AND i.resource_id = m.parent_id AND i.resource_id <> m.new_id;
      ALTER TABLE itinerary_items DROP COLUMN resource_price_id;
      ALTER TABLE itinerary_items ADD CONSTRAINT "CHK_itinerary_items_resource"
        CHECK (resource_id IS NOT NULL OR type = 'restaurant');
      DROP TABLE resource_attraction_prices;
      DROP TABLE resource_restaurant_prices;
    `);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Flattened attraction and restaurant records cannot be reverted',
      ),
    );
  }
}
