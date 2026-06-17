export const EncodingEra = {
  MODERN_WEB: 1,
  LEGACY_ISO: 2,
  LEGACY_MAC: 4,
  LEGACY_REGIONAL: 8,
  DOS: 16,
  MAINFRAME: 32,
  ALL: 63, // MODERN_WEB | LEGACY_ISO | LEGACY_MAC | LEGACY_REGIONAL | DOS | MAINFRAME
} as const;

export type EncodingEra = typeof EncodingEra[keyof typeof EncodingEra];

export const LanguageFilter = {
  CHINESE_SIMPLIFIED: 0x01,
  CHINESE_TRADITIONAL: 0x02,
  JAPANESE: 0x04,
  KOREAN: 0x08,
  NON_CJK: 0x10,
  ALL: 0x1F,
  CHINESE: 0x03,
  CJK: 0x0F,
} as const;

export type LanguageFilter = typeof LanguageFilter[keyof typeof LanguageFilter];
