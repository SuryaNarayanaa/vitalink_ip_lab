/** Parse a date-only DD-MM-YYYY or YYYY-MM-DD value without locale ambiguity. */
export function parseStrictDateOnly(value: string): Date | undefined {
  const match = value.match(/^(?:(\d{2})-(\d{2})-(\d{4})|(\d{4})-(\d{2})-(\d{2}))$/)
  if (!match) return undefined
  const day = Number(match[1] ?? match[6])
  const month = Number(match[2] ?? match[5])
  const year = Number(match[3] ?? match[4])
  // Persist date-only clinical values at UTC midnight so application instances
  // with different host timezones store the same instant for the same day.
  // Avoid Date.UTC year remapping for years 0–99 by constructing with a neutral
  // year and then applying setUTCFullYear with the requested year.
  const date = new Date(Date.UTC(2000, month - 1, day))
  date.setUTCFullYear(year)
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date
    : undefined
}

/** Return the sortable YYYY-MM-DD key encoded by a validated date-only value. */
export function dateOnlyStringKey(value: string): string | undefined {
  const match = value.match(/^(?:(\d{2})-(\d{2})-(\d{4})|(\d{4})-(\d{2})-(\d{2}))$/)
  if (!match || !parseStrictDateOnly(value)) return undefined
  const day = match[1] ?? match[6]
  const month = match[2] ?? match[5]
  const year = match[3] ?? match[4]
  return `${year}-${month}-${day}`
}

/** Format an instant as a sortable calendar-date key in an explicit timezone. */
export function calendarDateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(item => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}
