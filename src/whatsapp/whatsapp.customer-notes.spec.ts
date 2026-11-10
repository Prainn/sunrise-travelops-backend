import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { CustomerNotesDto } from './whatsapp.dto';

const errors = (values: Record<string, unknown>) =>
  validateSync(plainToInstance(CustomerNotesDto, { version: 1, ...values }), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('WhatsApp customer notes draft validation', () => {
  it('allows incomplete drafts without inventing days, people or country', () => {
    const draft = plainToInstance(CustomerNotesDto, { version: 1 });
    expect(validateSync(draft)).toHaveLength(0);
    expect(draft.plannedDays).toBeNull();
    expect(draft.pax).toBeNull();
    expect(draft.countryItemId).toBeNull();
    expect(draft.startDate).toBeNull();
    expect(draft.destinations).toEqual([]);
  });
  it('normalizes manual customer names and accepts inquiry-compatible values', () => {
    const draft = plainToInstance(CustomerNotesDto, {
      version: 3,
      customerName: '  Alice  ',
      plannedDays: 365,
      pax: 10000,
      countryItemId: randomUUID(),
      startDate: '2028-02-29',
      destinations: [randomUUID()],
    });
    expect(draft.customerName).toBe('Alice');
    expect(validateSync(draft)).toHaveLength(0);
  });
  it.each([
    { version: 0 },
    { version: undefined },
    { customerName: 'x'.repeat(101) },
    { plannedDays: 0 },
    { plannedDays: 366 },
    { plannedDays: 1.5 },
    { pax: 0 },
    { pax: 10001 },
    { pax: '5' },
    { countryItemId: '' },
    { startDate: '2026-02-30' },
    { startDate: '2026-11' },
    { destinations: ['not-a-uuid'] },
    {
      destinations: [
        '66fdeafb-6777-4a16-9bea-2c521c238312',
        '66fdeafb-6777-4a16-9bea-2c521c238312',
      ],
    },
    { contactInfo: 'x'.repeat(501) },
    { internalRemark: 'x'.repeat(20001) },
    { requirements: 'x'.repeat(200001) },
    { ownerId: randomUUID() },
  ])('rejects invalid values or unrelated fields: %o', (values) => {
    expect(errors(values).length).toBeGreaterThan(0);
  });
});
