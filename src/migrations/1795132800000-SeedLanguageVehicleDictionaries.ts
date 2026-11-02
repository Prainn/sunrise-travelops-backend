import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedLanguageVehicleDictionaries1795132800000 implements MigrationInterface {
  name = 'SeedLanguageVehicleDictionaries1795132800000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`INSERT INTO system_business_dictionary_types
      (code,name,english_name,is_built_in) VALUES
      ('guide-language','语言','Languages',true),
      ('vehicle-type','车型','Vehicle Types',true)
      ON CONFLICT (code) DO UPDATE SET is_built_in=true`);
    // Keep the seed definition here so later catalog edits cannot alter this migration.
    const languages = [
      ['mandarin', '中文', 'Mandarin'],
      ['english', '英文', 'English'],
      ['cantonese', '粤语', 'Cantonese'],
      ['japanese', '日语', 'Japanese'],
      ['korean', '韩语', 'Korean'],
      ['french', '法语', 'French'],
      ['german', '德语', 'German'],
      ['spanish', '西班牙语', 'Spanish'],
      ['russian', '俄语', 'Russian'],
      ['thai', '泰语', 'Thai'],
      ['vietnamese', '越南语', 'Vietnamese'],
      ['italian', '意大利语', 'Italian'],
    ];
    const vehicles = [5, 7, 9, 14, 18, 19, 22, 23, 33, 49, 53].map((seats) => [
      `seat${seats}`,
      `${seats}座`,
      `${seats}-seat vehicle`,
    ]);
    for (const [type, entries] of [
      ['guide-language', languages],
      ['vehicle-type', vehicles],
    ] as const) {
      for (const [code, name, englishName] of entries) {
        await q.query(
          `INSERT INTO system_business_dictionary_items
          (type_id,code,name,english_name,status)
          SELECT id,$2,$3,$4,'enabled' FROM system_business_dictionary_types WHERE code=$1
          ON CONFLICT (type_id,code) DO NOTHING`,
          [type, code, name, englishName],
        );
      }
    }
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Language and vehicle dictionaries are retained on application rollback.',
      ),
    );
  }
}
