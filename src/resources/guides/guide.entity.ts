import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  Unique,
} from 'typeorm';
import { SupplierEntity } from '../suppliers/supplier.entity';
import { TopLevelResourceEntity } from '../common/resource.entity';
import { GuideEmploymentType, GuideGender } from '../common/resource.constants';

@Entity({ name: 'resource_guides' })
@Unique('UQ_resource_guides_code', ['code'])
@Check('CHK_resource_guides_status', `"status" IN ('enabled', 'disabled')`)
@Index(
  'IDX_resource_guides_filters',
  ['status', 'gender', 'employmentType', 'unit'],
  { where: '"deleted_at" IS NULL' },
)
@Index('IDX_resource_guides_supplier', ['groundOperatorId'], {
  where: '"deleted_at" IS NULL AND "ground_operator_id" IS NOT NULL',
})
@Check('CHK_resource_guides_gender', "\"gender\" IN ('male', 'female')")
@Check(
  'CHK_resource_guides_employment_type',
  "\"employment_type\" IN ('full-time', 'part-time')",
)
@Check('CHK_resource_guides_age', '"age" > 0 AND "age" <= 130')
@Check(
  'CHK_resource_guides_daily_price',
  '"daily_price" IS NULL OR "daily_price" >= 0',
)
@Check(
  'CHK_resource_guides_supplier',
  '("is_ground_operator_provided" = false AND "ground_operator_id" IS NULL) OR ("is_ground_operator_provided" = true AND "ground_operator_id" IS NOT NULL)',
)
export class GuideEntity extends TopLevelResourceEntity {
  @Column({ name: 'certificate_no', type: 'varchar', length: 100 })
  certificateNo: string;
  @Column({ type: 'varchar', length: 10 }) gender: GuideGender;
  @Column({ type: 'integer' }) age: number;
  @Column({ type: 'text', array: true }) languages: string[];
  @Column({ name: 'employment_type', type: 'varchar', length: 20 })
  employmentType: GuideEmploymentType;
  @Column({ name: 'identity_number', type: 'varchar', length: 100 })
  identityNumber: string;
  @Column({ type: 'varchar', length: 50 }) phone: string;
  @Column({
    name: 'daily_price',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  dailyPrice: string | null;
  @Column({ type: 'varchar', length: 100 }) unit: string;
  @Column({ name: 'has_labor_contract', type: 'boolean', default: false })
  hasLaborContract: boolean;
  @Column({
    name: 'is_ground_operator_provided',
    type: 'boolean',
    default: false,
  })
  isGroundOperatorProvided: boolean;
  @Column({ name: 'ground_operator_id', type: 'uuid', nullable: true })
  groundOperatorId: string | null;
  @ManyToOne(() => SupplierEntity, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({
    name: 'ground_operator_id',
    foreignKeyConstraintName: 'FK_resource_guides_supplier',
  })
  groundOperator: SupplierEntity | null;
  @Column({ name: 'license_photo_url', type: 'text', default: '' })
  licensePhotoUrl: string;
  @Column({ type: 'text', default: '' }) remark: string;
}
