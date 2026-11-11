import type { EntityManager } from 'typeorm';
import type { ItineraryInput } from './inquiry.dto';
import type { InquiryEntity, CurrentPdfData } from './inquiry.entity';
import {
  buildCustomerPresentation,
  exportSnapshot,
} from './customer-presentation';

it('resolves resource English at preview and leaves missing English blank', async () => {
  const manager = {
    query: jest.fn((sql: string) => {
      if (sql.includes('resource_cities'))
        return Promise.resolve([{ name: '昆明', englishName: 'Kunming' }]);
      if (sql.includes('resource_attractions'))
        return Promise.resolve([
          {
            id: 'a',
            englishName: '',
            englishDescription: 'Visit the stone forest.',
          },
        ]);
      return Promise.resolve([]);
    }),
  } as unknown as EntityManager;
  const plan = {
    title: '中文标题',
    destinations: ['昆明'],
    startDate: '2026-11-11',
    hotelPlans: [],
    dailyPlans: [
      {
        id: 'd1',
        dayNumber: 1,
        date: '2026-11-11',
        departure: '自定义城市',
        destination: '昆明',
        departureEn: 'Old override',
        destinationEn: 'Old destination',
        transport: 'bus',
        transportEn: 'Old transport',
        description: '中文正文',
        descriptionEn: 'Old manual text',
        overnightDestination: '',
        meals: { breakfast: false, lunch: false, dinner: false },
        items: [
          {
            id: 'i',
            type: 'attraction',
            resourceId: 'a',
            resourceName: '石林',
            unit: 'personVisit',
            remark: '',
          },
        ],
      },
    ],
    quote: {
      transportFees: [],
      customerNotes: '',
      holidayRestrictions: '',
      hotelReplacementTerms: '',
    },
  } as unknown as ItineraryInput;
  const presentation = await buildCustomerPresentation(manager, plan, {
    countryOrRegion: '中国',
  } as InquiryEntity);
  expect(presentation.en).toMatchObject({
    title: '',
    country: '',
    days: [
      {
        route: ['Kunming'],
        transport: '',
        description: 'Visit the stone forest.',
        items: [{ name: '' }],
      },
    ],
  });
  const snapshot = { customerPresentation: presentation } as CurrentPdfData;
  expect(exportSnapshot(snapshot, 'en').exportLanguage).toBe('en');
  expect(snapshot).not.toHaveProperty('exportLanguage');
  expect(exportSnapshot({} as CurrentPdfData, 'en').exportLanguage).toBe('en');
});
