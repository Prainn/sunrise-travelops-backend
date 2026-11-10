/** Disposable local database; real guards/SQL, synthetic contacts, no cloud sends. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AddWhatsappCustomerNotes1795910400000 } from '../src/migrations/1795910400000-AddWhatsappCustomerNotes';
import { WhatsappEvents } from '../src/whatsapp/whatsapp.events';
import { Actor, IsolationHarness, Page } from './business-isolation.harness';

const h = new IsolationHarness({
  WHATSAPP_CHAT_ENABLED: 'true',
  WHATSAPP_CHAT_WORKER_ENABLED: 'false',
  WHATSAPP_CHAT_RECEIVE_MODE: 'http',
  WHATSAPP_CHAT_SEND_ENABLED: 'false',
  WHATSAPP_CHAT_ENVIRONMENT: 'test',
  WHATSAPP_CHAT_SPACE_ID: 'notes-test-space',
  WHATSAPP_CHAT_WABA_ID: 'notes-test-waba',
  WHATSAPP_CHAT_PHONE: '0000000000',
  WHATSAPP_CHAT_HTTP_TOKEN:
    'test-only-customer-notes-http-token-never-used-outside-tests',
  WHATSAPP_CHAT_SOURCE_TOKEN:
    'test-only-customer-notes-source-token-never-used-outside-tests',
});
interface Notes {
  conversationId: string;
  version: number;
  customerName: string;
  countryItemId: string | null;
  plannedDays: number | null;
  startDate: string | null;
  pax: number | null;
  contactInfo: string;
  destinations: string[];
  requirements: string;
  internalRemark: string;
  updatedAt: string | null;
}
let checks = 0;
async function check(name: string, action: () => Promise<void>) {
  await action();
  console.log(`PASS ${++checks}: ${name}`);
}
async function main() {
  await h.start();
  const owner = await h.actor('website');
  const other = await h.actor('website');
  const manager = await h.actor('website', 'BUSINESS_MANAGER');
  const foreign = await h.actor('linxi', 'BUSINESS_MANAGER');
  const ids = {
    account: randomUUID(),
    contact: randomUUID(),
    conversation: randomUUID(),
  };
  const route = `/whatsapp/conversations/${ids.conversation}/customer-notes`;
  const get = (actor: Actor = owner) => h.call<Notes>(actor, 'GET', route);
  let notes: Notes;
  const input = (n: Notes) => {
    const { conversationId, updatedAt, ...fields } = n;
    assert(conversationId);
    void updatedAt;
    return fields;
  };
  const [country] = await h.db.query<{ id: string }[]>(
    "SELECT i.id FROM system_business_dictionary_items i JOIN system_business_dictionary_types t ON t.id=i.type_id WHERE t.code='country-region' AND i.code='UNKNOWN'",
  );
  assert(country);
  await check(
    'upgrade preserves representative old contact, conversation, message and inquiry; repeat is empty',
    async () => {
      const inquiry = await h.call<{ id: string }>(
        owner,
        'POST',
        '/website/inquiries',
        {
          countryItemId: country.id,
          customerName: 'Existing inquiry',
          plannedDays: 2,
          requirements: 'Original inquiry',
        },
        201,
      );
      await h.db.transaction(async (m) => {
        assert(m.queryRunner);
        await new AddWhatsappCustomerNotes1795910400000().down(m.queryRunner);
        await m.query('DELETE FROM migrations WHERE name=$1', [
          'AddWhatsappCustomerNotes1795910400000',
        ]);
      });
      await h.db.query(
        'INSERT INTO whatsapp_accounts(id,space_id,waba_id,phone) VALUES($1,$2,$3,$4)',
        [ids.account, 'notes-test-space', 'notes-test-waba', '0000000000'],
      );
      await h.db.query(
        'INSERT INTO whatsapp_contacts(id,account_id,name,bsuid) VALUES($1,$2,$3,$4)',
        [ids.contact, ids.account, 'Supplier name', 'ZZ.notes-contact'],
      );
      await h.db.query(
        "INSERT INTO whatsapp_identities(account_id,kind,value,contact_id) VALUES($1,'bsuid','ZZ.notes-contact',$2)",
        [ids.account, ids.contact],
      );
      await h.db.query(
        'INSERT INTO whatsapp_conversations(id,account_id,contact_id,owner_id) VALUES($1,$2,$3,$4)',
        [ids.conversation, ids.account, ids.contact, owner.id],
      );
      await h.db.query(
        "INSERT INTO whatsapp_messages(account_id,conversation_id,direction,source,kind,text,status,occurred_at) VALUES($1,$2,'inbound','customer','text','Original incoming text','received',now())",
        [ids.account, ids.conversation],
      );
      assert.equal((await h.db.runMigrations()).length, 1);
      assert.equal((await h.db.runMigrations()).length, 0);
      const existing = await h.call<{ requirements: string }>(
        owner,
        'GET',
        `/website/inquiries/${inquiry.id}`,
      );
      assert.equal(existing.requirements, 'Original inquiry');
      notes = await get();
      assert.equal(notes.customerName, 'Supplier name');
      assert.equal(notes.requirements, 'Original incoming text');
      assert.equal(notes.plannedDays, null);
      assert.equal(notes.countryItemId, null);
      assert.equal(notes.updatedAt, null);
    },
  );
  await check(
    'scope, permissions, invalid ranges and invalid resource references reject without changing data',
    async () => {
      await h.call(other, 'GET', route, undefined, 404, 'NOT_FOUND');
      await h.call(foreign, 'GET', route, undefined, 403, 'AUTH_FORBIDDEN');
      await h.call(other, 'PUT', route, input(notes), 404, 'NOT_FOUND');
      for (const invalid of [
        { plannedDays: 0 },
        { pax: 0 },
        { startDate: '2026-02-30' },
        { countryItemId: randomUUID() },
        { destinations: [randomUUID()] },
      ]) {
        await h.call(
          owner,
          'PUT',
          route,
          { ...input(notes), ...invalid },
          400,
          'VALIDATION_ERROR',
        );
      }
      assert.deepEqual(await get(), notes);
    },
  );
  const cityId = randomUUID();
  await h.db.query(
    "UPDATE website_config_versions v SET config=jsonb_set(v.config,'{cities}',v.config->'cities' || $1::jsonb) FROM website_config_current c WHERE c.business_unit='website' AND c.version=v.version AND v.business_unit='website'",
    [
      JSON.stringify([
        {
          id: cityId,
          nameZh: '测试城市',
          nameEn: 'Synthetic city',
          status: 'enabled',
        },
      ]),
    ],
  );
  await check(
    'incomplete drafts are allowed and successful manual name updates list, detail and search',
    async () => {
      notes = await h.call<Notes>(owner, 'PUT', route, {
        version: notes.version,
        customerName: '  Agent name  ',
      });
      assert.equal(notes.customerName, 'Agent name');
      assert.equal(notes.plannedDays, null);
      assert.equal(notes.version, 2);
      const list = await h.call<Page<{ id: string; name: string }>>(
        owner,
        'GET',
        '/whatsapp/conversations?keyword=Agent%20name',
      );
      assert.equal(list.total, 1);
      assert.equal(list.list[0].name, 'Agent name');
      const detail = await h.call<{
        name: string;
        capabilities: { canUpdateCustomer: boolean };
      }>(owner, 'GET', `/whatsapp/conversations/${ids.conversation}`);
      assert.equal(detail.name, 'Agent name');
      assert.equal(detail.capabilities.canUpdateCustomer, true);
      await h.call(
        owner,
        'PUT',
        route,
        { ...input(notes), version: 1 },
        409,
        'CONFLICT',
      );
    },
  );
  await check(
    'provider name changes do not replace the manual name; clearing restores provider name',
    async () => {
      const events = h.get(WhatsappEvents);
      await events.receive(
        {
          MessageId: 'notes-new-inbound',
          CustSpaceId: 'notes-test-space',
          WabaId: 'notes-test-waba',
          FromUserId: 'ZZ.notes-contact',
          To: '0000000000',
          Type: 'TEXT',
          Message: 'New provider message',
          Name: 'Latest provider',
          Timestamp: Date.now(),
        },
        'inbound',
      );
      await events.processOne();
      notes = await get();
      assert.equal(notes.customerName, 'Agent name');
      notes = await h.call<Notes>(owner, 'PUT', route, {
        ...input(notes),
        customerName: '',
      });
      assert.equal(notes.customerName, 'Latest provider');
    },
  );
  await check(
    'simultaneous edits with one version commit once and reject stale writes',
    async () => {
      const results = await Promise.allSettled([
        h.call<Notes>(owner, 'PUT', route, {
          ...input(notes),
          customerName: 'Concurrent one',
        }),
        h.call<Notes>(manager, 'PUT', route, {
          ...input(notes),
          customerName: 'Concurrent two',
        }),
      ]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      const failure = results.find((r) => r.status === 'rejected');
      assert(failure?.status === 'rejected');
      assert.match(String(failure.reason), /409|CONFLICT/);
      notes = await get();
    },
  );
  await check(
    'saved inquiry fields prefill exactly; creation form name also synchronizes; original messages survive',
    async () => {
      notes = await h.call<Notes>(owner, 'PUT', route, {
        ...input(notes),
        countryItemId: country.id,
        plannedDays: 6,
        startDate: '2027-02-03',
        pax: 4,
        contactInfo: 'Synthetic contact details',
        destinations: [cityId],
        requirements: 'Confirmed travel requirements',
        internalRemark: 'Internal planning note',
      });
      const prefill = await h.call<{
        input: Record<string, unknown>;
        version: number;
      }>(
        owner,
        'GET',
        `/whatsapp/conversations/${ids.conversation}/inquiry-prefill`,
      );
      for (const key of [
        'countryItemId',
        'plannedDays',
        'startDate',
        'pax',
        'contactInfo',
        'destinations',
        'requirements',
        'internalRemark',
      ] as const)
        assert.deepEqual(prefill.input[key], notes[key]);
      const created = await h.call<{ inquiryId: string }>(
        owner,
        'POST',
        `/whatsapp/conversations/${ids.conversation}/inquiry`,
        {
          ...prefill.input,
          version: prefill.version,
          customerName: 'Inquiry form name',
        },
        201,
      );
      notes = await get();
      assert.equal(notes.customerName, 'Inquiry form name');
      notes = await h.call<Notes>(owner, 'PUT', route, {
        ...input(notes),
        plannedDays: 12,
        internalRemark: 'Later note',
      });
      const inquiry = await h.call<{
        plannedDays: number;
        internalRemark: string;
        customerName: string;
      }>(owner, 'GET', `/website/inquiries/${created.inquiryId}`);
      assert.equal(inquiry.plannedDays, 6);
      assert.equal(inquiry.internalRemark, 'Internal planning note');
      assert.equal(inquiry.customerName, 'Inquiry form name');
      await h.call(
        owner,
        'POST',
        `/whatsapp/conversations/${ids.conversation}/inquiry`,
        {
          ...prefill.input,
          version: prefill.version,
          customerName: 'Duplicate name',
        },
        201,
      );
      assert.equal((await get()).customerName, 'Inquiry form name');
      const [original] = await h.db.query<{ text: string }[]>(
        'SELECT text FROM whatsapp_messages WHERE conversation_id=$1 ORDER BY seq LIMIT 1',
        [ids.conversation],
      );
      assert.equal(original.text, 'Original incoming text');
    },
  );
  await check(
    'archived notes are read-only and new consultations do not inherit prior trip data',
    async () => {
      await h.db.query(
        "UPDATE whatsapp_conversations SET state='archived',version=version+1 WHERE id=$1",
        [ids.conversation],
      );
      const old = await get();
      await h.call(owner, 'PUT', route, input(old), 409, 'CONFLICT');
      const next = randomUUID();
      await h.db.query(
        'INSERT INTO whatsapp_conversations(id,account_id,contact_id,owner_id,previous_id) VALUES($1,$2,$3,$4,$5)',
        [next, ids.account, ids.contact, owner.id, ids.conversation],
      );
      const fresh = await h.call<Notes>(
        owner,
        'GET',
        `/whatsapp/conversations/${next}/customer-notes`,
      );
      assert.equal(fresh.customerName, 'Inquiry form name');
      assert.equal(fresh.countryItemId, null);
      assert.equal(fresh.plannedDays, null);
      assert.equal(fresh.internalRemark, '');
      const detail = await h.call<{
        capabilities: { canUpdateCustomer: boolean };
      }>(owner, 'GET', `/whatsapp/conversations/${ids.conversation}`);
      assert.equal(detail.capabilities.canUpdateCustomer, false);
    },
  );
  await check(
    'rollback refuses existing customer notes and manual names',
    async () => {
      await assert.rejects(
        h.db.transaction(async (m) => {
          assert(m.queryRunner);
          await new AddWhatsappCustomerNotes1795910400000().down(m.queryRunner);
        }),
        /Refusing rollback/,
      );
      assert.equal((await get()).customerName, 'Inquiry form name');
    },
  );
  console.log(
    `Customer notes: ${checks} groups, ${h.requests} HTTP requests passed.`,
  );
}
main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => h.close());
