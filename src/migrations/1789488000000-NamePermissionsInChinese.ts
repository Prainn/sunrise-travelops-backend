import { MigrationInterface, QueryRunner } from 'typeorm';

// Keep historical migration labels independent of runtime permission definitions.
const names: Record<string, string> = {
  'sys:user:list': '查看用户',
  'sys:user:create': '新增用户',
  'sys:user:update': '修改用户',
  'sys:user:delete': '删除用户',
  'sys:role:list': '查看角色',
  'sys:role:create': '新增角色',
  'sys:role:update': '修改角色',
  'sys:role:delete': '删除角色',
  'sys:dict:list': '查看系统分类',
  'sys:dict:create': '新增系统分类',
  'sys:dict:update': '修改系统分类',
  'sys:dict:delete': '删除系统分类',
  'sys:dict-item:list': '查看系统分类选项',
  'sys:dict-item:create': '新增系统分类选项',
  'sys:dict-item:update': '修改系统分类选项',
  'sys:dict-item:delete': '删除系统分类选项',
  'sys:business-dictionary:list': '查看业务分类',
  'sys:business-dictionary:create': '新增业务分类',
  'sys:business-dictionary:update': '修改业务分类',
  'sys:business-dictionary:delete': '删除业务分类',
  'sys:user:import': '导入用户',
  'sys:user:export': '导出用户',
  'sys:user:reset-password': '重置用户密码',
  'resource:city:list': '查看城市',
  'resource:city:create': '新增城市',
  'resource:city:update': '修改城市',
  'resource:city:delete': '删除城市',
  'resource:agency:list': '查看旅行社',
  'resource:agency:create': '新增旅行社',
  'resource:agency:update': '修改旅行社',
  'resource:agency:delete': '删除旅行社',
  'resource:hotel:list': '查看酒店',
  'resource:hotel:create': '新增酒店',
  'resource:hotel:update': '修改酒店',
  'resource:hotel:delete': '删除酒店',
  'resource:restaurant:list': '查看餐厅',
  'resource:restaurant:create': '新增餐厅',
  'resource:restaurant:update': '修改餐厅',
  'resource:restaurant:delete': '删除餐厅',
  'resource:attraction:list': '查看景点',
  'resource:attraction:create': '新增景点',
  'resource:attraction:update': '修改景点',
  'resource:attraction:delete': '删除景点',
  'resource:transport:list': '查看车型',
  'resource:transport:create': '新增车型',
  'resource:transport:update': '修改车型',
  'resource:transport:delete': '删除车型',
  'resource:guide:list': '查看导游价格',
  'resource:guide:create': '新增导游价格',
  'resource:guide:update': '修改导游价格',
  'resource:guide:delete': '删除导游价格',
  'inquiry:list': '查看询盘',
  'inquiry:create': '创建询盘',
  'inquiry:update': '修改询盘',
  'inquiry:archive': '归档询盘',
  'inquiry:transfer': '询盘转交',
  'itinerary:list': '查看行程',
  'itinerary:create': '创建行程',
  'itinerary:update': '修改行程',
  'itinerary:price': '编辑行程报价',
  'itinerary:pdf': '确认报价并生成 PDF',
  'itinerary:download': '下载已有冻结报价',
};

export class NamePermissionsInChinese1789488000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    for (const [code, name] of Object.entries(names)) {
      await queryRunner.query(
        `UPDATE permissions SET name=$2 WHERE code=$1 AND (name=code OR btrim(name)='')`,
        [code, name],
      );
    }
  }

  async down(): Promise<void> {
    // Labels remain valid for the previous application; preserve business names.
  }
}
