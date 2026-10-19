import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateManualLedgers1792454400000 implements MigrationInterface {
  name = 'CreateManualLedgers1792454400000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE shengxu_ledgers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      record_date date NOT NULL, creator_id uuid NOT NULL REFERENCES users(id), creator_name text NOT NULL,
      agency_id uuid NOT NULL REFERENCES resource_agencies(id), agency_name text NOT NULL,
      country_or_region text NOT NULL, city text NOT NULL,
      contact_id uuid NOT NULL REFERENCES resource_agency_contacts(id), contact_name text NOT NULL,
      quoted_groups integer NOT NULL CHECK(quoted_groups >= 0), converted_groups integer NOT NULL CHECK(converted_groups >= 0),
      quote_sent boolean NOT NULL DEFAULT false, itinerary text NOT NULL DEFAULT '', not_converted_reason text NOT NULL DEFAULT '',
      version integer NOT NULL DEFAULT 1 CHECK(version > 0),
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by uuid NOT NULL REFERENCES users(id),
      CONSTRAINT uq_shengxu_ledger_date_agency UNIQUE(record_date,agency_id)
    );
    CREATE INDEX shengxu_ledgers_date ON shengxu_ledgers(record_date DESC,created_at DESC,id);
    CREATE SEQUENCE direct_ledger_order_seq;
    CREATE TABLE direct_ledgers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_unit text NOT NULL CHECK(business_unit IN ('linxi','website')),
      order_no text NOT NULL UNIQUE DEFAULT ('DL-' || lpad(nextval('direct_ledger_order_seq')::text,10,'0')),
      received_date date NOT NULL, source varchar(200) NOT NULL CHECK(length(trim(source))>0),
      creator_id uuid NOT NULL REFERENCES users(id), creator_name text NOT NULL,
      receiving_account_id uuid REFERENCES users(id), receiving_account_name text NOT NULL,
      operator_id uuid NOT NULL REFERENCES users(id), operator_name text NOT NULL,
      order_status text NOT NULL DEFAULT 'unconverted' CHECK(order_status IN ('unconverted','converted')),
      effective_contact boolean NOT NULL DEFAULT false, proposal_sent boolean NOT NULL DEFAULT false,
      loss boolean NOT NULL DEFAULT false, priority boolean NOT NULL DEFAULT false,
      itinerary text NOT NULL DEFAULT '', not_converted_reason text NOT NULL DEFAULT '', loss_note text NOT NULL DEFAULT '',
      remark text NOT NULL DEFAULT '', feedback_reason text NOT NULL DEFAULT '', solution text NOT NULL DEFAULT '',
      deal_date date, departure_date date, complaint boolean, satisfied boolean,
      reviewed_at timestamptz, reviewed_by uuid REFERENCES users(id),
      operated boolean NOT NULL DEFAULT false, operated_at timestamptz,
      version integer NOT NULL DEFAULT 1 CHECK(version > 0),
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid NOT NULL REFERENCES users(id),
      CHECK((business_unit='website' AND receiving_account_id IS NULL AND receiving_account_name='独立站') OR
        (business_unit='linxi' AND receiving_account_id IS NOT NULL)),
      CHECK((reviewed_at IS NULL) = (reviewed_by IS NULL)),
      CHECK(NOT operated OR operated_at IS NOT NULL),
      CHECK(operated_at IS NULL OR order_status='converted')
    );
    CREATE INDEX direct_ledgers_unit_date ON direct_ledgers(business_unit,received_date DESC,created_at DESC,id);
    UPDATE role_menu_configs c SET menu_keys = ARRAY(SELECT DISTINCT unnest(c.menu_keys || ARRAY['shengxu-ledger','direct-ledger']::text[])),
      version=version+1,updated_at=now() FROM roles r WHERE r.id=c.role_id AND r.code IN ('ROOT','ADMIN','EXECUTIVE','BUSINESS_MANAGER','COORDINATOR');`);
  }
  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Manual ledgers contain business records; retain tables and use a reviewed recovery plan',
      ),
    );
  }
}
