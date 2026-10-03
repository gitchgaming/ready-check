// Luxon convention: 1 = Monday ... 7 = Sunday.
export const WEEKDAY_CHOICES = [
  { name: "Monday", value: "1" },
  { name: "Tuesday", value: "2" },
  { name: "Wednesday", value: "3" },
  { name: "Thursday", value: "4" },
  { name: "Friday", value: "5" },
  { name: "Saturday", value: "6" },
  { name: "Sunday", value: "7" },
] as const;

const NAMES_BY_VALUE = new Map(WEEKDAY_CHOICES.map((c) => [Number(c.value), c.name]));

export function weekdayName(dayOfWeek: number): string {
  return NAMES_BY_VALUE.get(dayOfWeek) ?? `Day ${dayOfWeek}`;
}
