/**
 * Returns an ISO week identifier string for the given date.
 * Format: "YYYY-WNN" e.g. "2026-W08"
 * Uses ISO 8601 week numbering (week starts Monday, week 1 contains first Thursday).
 */
export function getISOWeekIdentifier(date: Date): string {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  // Set to nearest Thursday (ISO week rule: week contains Thursday)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const week1 = new Date(d.getFullYear(), 0, 4)
  const weekNum =
    1 +
    Math.round(
      ((d.getTime() - week1.getTime()) / 86400000 -
        3 +
        ((week1.getDay() + 6) % 7)) /
        7,
    )
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`
}
