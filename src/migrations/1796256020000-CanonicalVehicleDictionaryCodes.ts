import { MigrationInterface, QueryRunner } from 'typeorm';

export class CanonicalVehicleDictionaryCodes1796256020000 implements MigrationInterface {
  name = 'CanonicalVehicleDictionaryCodes1796256020000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`UPDATE system_business_dictionary_items AS i
      SET code=substring(i.code FROM 5)||'_seat', version=i.version+1, updated_at=now()
      FROM system_business_dictionary_types AS t
      WHERE t.id=i.type_id AND t.code='vehicle-type' AND i.code ~ '^seat[1-9][0-9]*$'`);
    await q.query(`INSERT INTO system_business_dictionary_items (type_id,code,name,english_name,status)
      SELECT id,'38_seat','38座','38-seat vehicle','enabled'
      FROM system_business_dictionary_types WHERE code='vehicle-type' AND deleted_at IS NULL
      ON CONFLICT (type_id,code) DO NOTHING`);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Vehicle codes are retained because editable itineraries and quotations reference them.',
      ),
    );
  }
}
