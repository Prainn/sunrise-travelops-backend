export enum DictionaryStatus {
  Disabled = 0,
  Enabled = 1,
}

export const DICTIONARY_TAG_TYPES = [
  '',
  'primary',
  'success',
  'info',
  'warning',
  'danger',
] as const;

export type DictionaryTagType = (typeof DICTIONARY_TAG_TYPES)[number];
