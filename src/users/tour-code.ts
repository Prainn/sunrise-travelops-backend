import { pinyin } from 'pinyin-pro';

export function tourCodeCandidates(
  englishName: string,
  nickname: string,
): string[] {
  const letters = englishName.replace(/[^a-z]/gi, '').toUpperCase();
  const chineseName = nickname.match(/\p{Script=Han}+/u)?.[0];
  if (!letters || !chineseName) return [];
  const initial = pinyin(chineseName, {
    surname: 'head',
    pattern: 'first',
    toneType: 'none',
    type: 'array',
  })[0]?.toUpperCase();
  if (!initial || !/^[A-Z]$/.test(initial)) return [];
  return Array.from(
    { length: Math.min(letters.length, 9) },
    (_, index) => letters.slice(0, index + 1) + initial,
  );
}
