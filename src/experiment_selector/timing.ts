/** Calendar validation at merchant-local midnight, including 23/25-hour DST days. */
export function measurementWindowFits(args: {
  asOf: string; approvedClock: string; timeZone: string; horizonDays: number;
  start: string; end: string; minimumDurationDays: number;
}): boolean {
  try {
    if (args.approvedClock !== args.asOf || !Number.isInteger(args.horizonDays) || !Number.isInteger(args.minimumDurationDays) || args.minimumDurationDays < 1) return false
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: args.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    const civil = (iso: string, requireMidnight: boolean): number => {
      if (!iso.endsWith('Z') || !Number.isFinite(Date.parse(iso))) throw Error('invalid timestamp')
      const parts = Object.fromEntries(formatter.formatToParts(new Date(iso)).map(p => [p.type, p.value]))
      if (requireMidnight && (parts.hour !== '00' || parts.minute !== '00' || parts.second !== '00' || new Date(iso).getUTCMilliseconds() !== 0)) throw Error('not local midnight')
      return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / 86400000
    }
    const start = civil(args.start, true), end = civil(args.end, true), asOf = civil(args.asOf, false)
    return Date.parse(args.start) >= Date.parse(args.asOf) && end - start >= args.minimumDurationDays && end <= asOf + args.horizonDays
  } catch { return false }
}
