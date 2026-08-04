const ROCKET_TIME_ZONE = 'Asia/Baghdad';

export function createRoomSupportPeriodIds(
  nowMillis: number,
  timeZone = ROCKET_TIME_ZONE,
) {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(new Date(nowMillis));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(value.year);
  const month = Number(value.month);
  const day = Number(value.day);
  const localDate = Date.UTC(year, month - 1, day);
  const mondayOffset = (new Date(localDate).getUTCDay() + 6) % 7;
  const monday = new Date(localDate - mondayOffset * 24 * 60 * 60 * 1000);
  const slug = timeZone.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const formatDate = (date: Date) => [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
  return {
    dayId: `day_${formatDate(new Date(localDate))}_${slug}`,
    weekId: `weekly_${formatDate(monday)}_${slug}`,
  };
}
