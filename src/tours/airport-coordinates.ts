/**
 * WGS84 [longitude, latitude], limited to the current airport catalog.
 * Source: https://ourairports.com/data/ (Public Domain), airports.csv retrieved 2026-10-27.
 * https://davidmegginson.github.io/ourairports-data/airports.csv
 * No request-time network lookup; unknown codes remain unlocated.
 */
export const AIRPORT_COORDINATES: Readonly<
  Record<string, readonly [number, number]>
> = {
  SHA: [121.33426, 31.198104],
  PVG: [121.805, 31.1434],
  PEK: [116.596702, 40.077349],
  PKX: [116.413967, 39.501289],
  CTU: [103.945966, 30.558257],
  TFU: [104.441284, 30.31252],
  CAN: [113.299004, 23.392401],
  SZX: [113.803262, 22.639474],
  KMG: [102.936743, 25.110313],
  LJG: [100.244944, 26.677483],
  DIG: [99.6772, 27.7936],
  XMN: [118.127454, 24.543889],
  HGH: [120.428865, 30.23609],
  WUH: [114.213723, 30.774798],
  FOC: [119.672524, 25.929254],
  CKG: [106.651895, 29.712254],
  HKG: [113.914862, 22.31184],
  BKK: [100.747002, 13.6811],
  DMK: [100.607002, 13.9126],
  RGN: [96.1332015991, 16.9073009491],
  MDL: [95.977897644, 21.7021999359],
  KTI: [104.921272, 11.359987],
  SIN: [103.994003, 1.35019],
  BWN: [114.928001, 4.9442],
  JHB: [103.669998, 1.64131],
  PEN: [100.276185, 5.296303],
  KUL: [101.709999, 2.74558],
  SZB: [101.549004, 3.13058],
};
