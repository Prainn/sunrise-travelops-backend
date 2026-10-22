import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateUserDto, UpdateUserDto } from './dto/user-management.dto';
import { tourCodeCandidates } from './tour-code';

describe('tour code candidates', () => {
  it.each([
    ['Evelyn', 'Evelyn马媛媛', 'EM', 'EVM'],
    ['Andrew', 'Andrew朱相龙', 'AZ', 'ANZ'],
    ['Arthur', 'Arthur郑赫', 'AZ', 'ARZ'],
    ['Allen', 'Allen张奥岚', 'AZ', 'ALZ'],
    ['Amy', 'Amy曾丽', 'AZ', 'AMZ'],
    ['Amy', 'Amy单丽', 'AS', 'AMS'],
    ['Amy', 'Amy欧阳丽', 'AO', 'AMO'],
  ])(
    'generates surname initials and longer prefixes for %s/%s',
    (english, nickname, first, second) => {
      expect(tourCodeCandidates(english, nickname).slice(0, 2)).toEqual([
        first,
        second,
      ]);
    },
  );
  it('does not guess a surname from the login name or non-Chinese nickname', () => {
    expect(tourCodeCandidates('Andrew', 'Andrew')).toEqual([]);
    expect(tourCodeCandidates('123', '朱相龙')).toEqual([]);
  });
  it('ignores punctuation and never exceeds the ten-character field limit', () => {
    const candidates = tourCodeCandidates(' a-bcdefghijkl ', '张明');
    expect(candidates[0]).toBe('AZ');
    expect(candidates.at(-1)).toBe('ABCDEFGHIZ');
  });
});

describe('tour code DTO requirements', () => {
  for (const Dto of [CreateUserDto, UpdateUserDto]) {
    const errors = async (scope: string, tourCode?: unknown) =>
      (
        await validate(
          plainToInstance(Dto, {
            identities: [{ scope }],
            tourCode,
          }),
        )
      ).filter((error) => error.property === 'tourCode');
    it(`${Dto.name} requires a code for each business scope`, async () => {
      for (const scope of ['shengxu', 'linxi', 'website']) {
        for (const missing of [undefined, null, '', '  ']) {
          expect(await errors(scope, missing)).not.toHaveLength(0);
        }
      }
    });
    it(`${Dto.name} allows missing headquarters code but validates a supplied value`, async () => {
      for (const missing of [undefined, null, '', '  '])
        expect(await errors('headquarters', missing)).toHaveLength(0);
      expect(await errors('headquarters', '  em ')).toHaveLength(0);
      expect(await errors('headquarters', 'bad!')).not.toHaveLength(0);
    });
  }
});
