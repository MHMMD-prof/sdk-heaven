import { VoiceRoom } from '../types/voice';

export const mockVoiceRooms: VoiceRoom[] = [
  {
    id: 'majlis-royal-evening',
    title: 'مجلس السهرة الملكية',
    hostId: 'host-salem',
    type: 'voice',
    countryCode: 'IQ',
    participantCount: 28,
    speakers: [
      { id: 'host-salem', displayName: 'سالم', avatarLabel: 'س' },
      { id: 'speaker-noura', displayName: 'نورة', avatarLabel: 'ن' },
      { id: 'speaker-majed', displayName: 'ماجد', avatarLabel: 'م' },
    ],
    listeners: [
      { id: 'listener-layan', displayName: 'ليان', avatarLabel: 'ل' },
      { id: 'listener-hala', displayName: 'هالة', avatarLabel: 'هـ' },
      { id: 'listener-fahad', displayName: 'فهد', avatarLabel: 'ف' },
    ],
  },
  {
    id: 'majlis-carrom',
    title: 'ديوانية الكاروم الهادئة',
    hostId: 'host-rakan',
    type: 'game',
    countryCode: 'SA',
    participantCount: 16,
    currentGameId: 'carrom-royal',
    speakers: [
      { id: 'host-rakan', displayName: 'راكان', avatarLabel: 'ر' },
      { id: 'speaker-jood', displayName: 'جود', avatarLabel: 'ج' },
    ],
    listeners: [
      { id: 'listener-sara', displayName: 'سارة', avatarLabel: 'س' },
      { id: 'listener-omar', displayName: 'عمر', avatarLabel: 'ع' },
    ],
  },
  {
    id: 'majlis-new-players',
    title: 'مجلس الترحيب باللاعبين',
    hostId: 'host-dana',
    type: 'voice',
    countryCode: 'YE',
    participantCount: 9,
    speakers: [
      { id: 'host-dana', displayName: 'دانا', avatarLabel: 'د' },
      { id: 'speaker-yousef', displayName: 'يوسف', avatarLabel: 'ي' },
    ],
    listeners: [
      { id: 'listener-maryam', displayName: 'مريم', avatarLabel: 'م' },
      { id: 'listener-ali', displayName: 'علي', avatarLabel: 'ع' },
    ],
  },
];
