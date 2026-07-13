/** Parse a date-only DD-MM-YYYY or YYYY-MM-DD value without locale ambiguity. */
export function parseStrictDateOnly(value: string): Date | undefined {
  const match = value.match(/^(?:(\d{2})-(\d{2})-(\d{4})|(\d{4})-(\d{2})-(\d{2}))$/)
  if (!match) return undefined
  const day = Number(match[1] ?? match[6])
  const month = Number(match[2] ?? match[5])
  const year = Number(match[3] ?? match[4])
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : undefined
}
