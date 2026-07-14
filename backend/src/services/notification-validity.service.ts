function resolveFollowingLocalMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const localTomorrow = new Date(Date.UTC(year, month - 1, day + 1))
  // Resolve the zone offset at the target wall-clock time. The second pass
  // handles offset changes (including daylight-saving boundaries).
  const offsetAt = (instant: Date) => {
    const zoned = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(instant)
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      Number(zoned.find(item => item.type === type)?.value ?? 0)
    const representedAsUtc = Date.UTC(
      part('year'), part('month') - 1, part('day'),
      part('hour'), part('minute'), part('second'),
    )
    return representedAsUtc - instant.getTime()
  }
  let result = new Date(localTomorrow.getTime() - offsetAt(localTomorrow))
  result = new Date(localTomorrow.getTime() - offsetAt(result))
  return result
}

/** Return the first instant of the following calendar day in `timeZone`. */
export function endOfLocalClinicalDay(date: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find(part => part.type === type)?.value ?? 0)
  return resolveFollowingLocalMidnight(value('year'), value('month'), value('day'), timeZone)
}

/** Resolve midnight following a YYYY-MM-DD wall date in `timeZone`. */
export function endOfLocalClinicalDateKey(dateKey: string, timeZone: string): Date {
  const normalized = dateOnlyStringKey(dateKey)
  if (!normalized || normalized !== dateKey) throw new Error('Invalid clinical date key')
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized)!
  return resolveFollowingLocalMidnight(Number(match[1]), Number(match[2]), Number(match[3]), timeZone)
}
import { dateOnlyStringKey } from '@alias/utils/dateOnly'
