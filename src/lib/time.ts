/** Parses a strict "HH:MM" 24-hour string. Returns null if invalid. */
export function parseHourMinute(input: string): { hour: number; minute: number } | null {
  const match = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/.exec(input.trim());
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}
