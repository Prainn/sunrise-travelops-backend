import { Check, Column, Entity, Index, Unique } from 'typeorm';
import { TopLevelResourceEntity } from '../common/resource.entity';

@Entity({ name: 'resource_guide_people' })
@Unique('UQ_resource_guide_people_code', ['code'])
@Index('IDX_resource_guide_people_library_status', ['library', 'status'], {
  where: '"deleted_at" IS NULL',
})
@Check('CHK_resource_guide_people_gender', '"gender" IN (0,1,2)')
@Check('CHK_resource_guide_people_age', '"age" IS NULL OR "age" >= 0')
@Check(
  'CHK_resource_guide_people_employment_type',
  `"employment_type" IS NULL OR "employment_type" IN ('full_time', 'part_time')`,
)
@Check('CHK_resource_guide_people_status', `"status" IN ('enabled','disabled')`)
export class GuidePersonEntity extends TopLevelResourceEntity {
  @Column({ type: 'integer', default: 0 }) gender: number;
  @Column({ type: 'integer', nullable: true }) age: number | null;
  @Column({ type: 'text', nullable: true }) contact: string | null;
  @Column({ name: 'employment_type', type: 'text', nullable: true })
  employmentType: 'full_time' | 'part_time' | null;
  @Column({ name: 'has_labor_contract', type: 'boolean', nullable: true })
  hasLaborContract: boolean | null;
  @Column({ type: 'text', nullable: true }) remark: string | null;
  @Column({ name: 'certificate_no', type: 'text', nullable: true })
  certificateNo: string | null;
  @Column({ name: 'identity_number', type: 'text', nullable: true })
  identityNumber: string | null;
}
