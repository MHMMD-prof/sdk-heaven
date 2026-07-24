import { ImageSourcePropType } from 'react-native';

import { RoomCountryCode } from '../types/voice';

export type RoomCountryOption = {
  code: RoomCountryCode;
  flag: ImageSourcePropType;
  label: string;
};

export const roomCountries: readonly RoomCountryOption[] = [
  { code: 'IQ', flag: require('../../assets/home/flags/iq.png'), label: 'العراق' },
  { code: 'SA', flag: require('../../assets/home/flags/sa.png'), label: 'السعودية' },
  { code: 'SY', flag: require('../../assets/home/flags/sy.png'), label: 'سوريا' },
  { code: 'LB', flag: require('../../assets/home/flags/lb.png'), label: 'لبنان' },
  { code: 'YE', flag: require('../../assets/home/flags/ye.png'), label: 'اليمن' },
  { code: 'DZ', flag: require('../../assets/home/flags/dz.png'), label: 'الجزائر' },
  { code: 'EG', flag: require('../../assets/home/flags/eg.png'), label: 'مصر' },
  { code: 'JO', flag: require('../../assets/home/flags/jo.png'), label: 'الأردن' },
  { code: 'PS', flag: require('../../assets/home/flags/ps.png'), label: 'فلسطين' },
  { code: 'AE', flag: require('../../assets/home/flags/ae.png'), label: 'الإمارات' },
  { code: 'KW', flag: require('../../assets/home/flags/kw.png'), label: 'الكويت' },
  { code: 'QA', flag: require('../../assets/home/flags/qa.png'), label: 'قطر' },
  { code: 'BH', flag: require('../../assets/home/flags/bh.png'), label: 'البحرين' },
  { code: 'OM', flag: require('../../assets/home/flags/om.png'), label: 'عُمان' },
  { code: 'MA', flag: require('../../assets/home/flags/ma.png'), label: 'المغرب' },
  { code: 'TN', flag: require('../../assets/home/flags/tn.png'), label: 'تونس' },
  { code: 'LY', flag: require('../../assets/home/flags/ly.png'), label: 'ليبيا' },
  { code: 'SD', flag: require('../../assets/home/flags/sd.png'), label: 'السودان' },
  { code: 'SO', flag: require('../../assets/home/flags/so.png'), label: 'الصومال' },
  { code: 'DJ', flag: require('../../assets/home/flags/dj.png'), label: 'جيبوتي' },
  { code: 'MR', flag: require('../../assets/home/flags/mr.png'), label: 'موريتانيا' },
  { code: 'KM', flag: require('../../assets/home/flags/km.png'), label: 'جزر القمر' },
];

export function getRoomCountry(code?: RoomCountryCode) {
  return roomCountries.find((country) => country.code === code);
}
