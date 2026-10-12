import { Check, Column, Entity, Index, Unique } from 'typeorm';
import { TopLevelResourceEntity } from '../common/resource.entity';
export const GUIDE_LANGUAGES = [
  'none',
  'en',
  'th',
  'vi',
  'ms',
  'id',
  'my',
  'km',
  'lo',
] as const;
export const GUIDE_LANGUAGE_LABELS: Record<string, string> = {
  none: '仅中文',
  en: '中文+英文',
  th: '中文+泰语',
  vi: '中文+越南语',
  ms: '中文+马来语',
  id: '中文+印尼语',
  my: '中文+缅甸语',
  km: '中文+高棉语',
  lo: '中文+老挝语',
};
export function guideName(language: string, shopping: boolean) {
  return `${GUIDE_LANGUAGE_LABELS[language]} · ${shopping ? '进店' : '不进店'}`;
}
@Entity({ name: 'resource_guides' })
@Unique('UQ_resource_guides_code', ['code'])
@Index('UQ_resource_guides_service', ['secondLanguage', 'shopping'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
@Check('CHK_resource_guides_status', `"status" IN ('enabled', 'disabled')`)
@Check('CHK_resource_guides_daily_price', '"daily_price" >= 0')
@Check(
  'CHK_resource_guides_language',
  `"second_language" IN ('none','en','th','vi','ms','id','my','km','lo')`,
)
export class GuideEntity extends TopLevelResourceEntity {
  @Column({ name: 'daily_price', type: 'numeric', precision: 12, scale: 2 })
  dailyPrice: string;
  @Column({ name: 'second_language', type: 'varchar', length: 20 })
  secondLanguage: string;
  @Column({ type: 'boolean' }) shopping: boolean;
}
