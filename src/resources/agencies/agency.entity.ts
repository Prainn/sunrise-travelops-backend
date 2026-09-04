import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  Unique,
} from 'typeorm';
import {
  TopLevelResourceEntity,
  VersionedResourceEntity,
} from '../common/resource.entity';

@Entity({ name: 'resource_agencies' })
@Unique('UQ_resource_agencies_code', ['code'])
@Check('CHK_resource_agencies_status', `"status" IN ('enabled', 'disabled')`)
@Index('IDX_resource_agencies_status', ['status'], {
  where: '"deleted_at" IS NULL',
})
export class AgencyEntity extends TopLevelResourceEntity {
  @Column({ type: 'varchar', length: 100, default: '' })
  city: string;

  @Column({
    name: 'country_or_region',
    type: 'varchar',
    length: 100,
    default: '',
  })
  countryOrRegion: string;

  @Column({ type: 'varchar', length: 254, default: '' })
  email: string;

  @Column({ type: 'text', default: '' })
  remark: string;

  @OneToMany(() => AgencyContactEntity, (contact) => contact.agency)
  contacts: AgencyContactEntity[];
}

@Entity({ name: 'resource_agency_contacts' })
@Index('UQ_resource_agency_contacts_agency_name_key', ['agencyId', 'nameKey'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
@Index('IDX_resource_agency_contacts_agency', ['agencyId'], {
  where: '"deleted_at" IS NULL',
})
export class AgencyContactEntity extends VersionedResourceEntity {
  @Column({ name: 'agency_id', type: 'uuid' })
  agencyId: string;

  @ManyToOne(() => AgencyEntity, (agency) => agency.contacts, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'agency_id',
    foreignKeyConstraintName: 'FK_resource_agency_contacts_agency',
  })
  agency: AgencyEntity;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'name_key', type: 'varchar', length: 100 })
  nameKey: string;

  @Column({ type: 'varchar', length: 50, default: '' })
  phone: string;
}
