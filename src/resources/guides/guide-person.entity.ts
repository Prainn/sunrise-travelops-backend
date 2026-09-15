import { Check, Column, Entity, Index, Unique } from 'typeorm';
import { TopLevelResourceEntity } from '../common/resource.entity';

@Entity({ name: 'resource_guide_people' })
@Unique('UQ_resource_guide_people_code', ['code'])
@Index('IDX_resource_guide_people_library_status', ['library', 'status'], {
  where: '"deleted_at" IS NULL',
})
@Check('CHK_resource_guide_people_gender', '"gender" IN (0,1,2)')
@Check('CHK_resource_guide_people_status', `"status" IN ('enabled','disabled')`)
export class GuidePersonEntity extends TopLevelResourceEntity {
  @Column({ type: 'integer', default: 0 }) gender: number;
  @Column({ name: 'certificate_no', type: 'text', nullable: true })
  certificateNo: string | null;
  @Column({ name: 'identity_number', type: 'text', nullable: true })
  identityNumber: string | null;
}
