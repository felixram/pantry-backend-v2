import { describe, it, expect } from "vitest"
import { doesScheduleMatchNow } from "../../../utils/countReminderSchedule.ts"

describe("countReminderSchedule module", () => {
  describe("doesScheduleMatchNow", () => {
    it("matches when day and hour align in UTC", () => {
      // 2026-01-15 is a Thursday (day index 4)
      const now = new Date("2026-01-15T14:00:00Z")
      expect(doesScheduleMatchNow({ day: 4, time: "14:00", tz: "UTC" }, now)).toBe(true)
    })

    it("does not match a different day", () => {
      const now = new Date("2026-01-15T14:00:00Z") // Thursday
      expect(doesScheduleMatchNow({ day: 3, time: "14:00", tz: "UTC" }, now)).toBe(false)
    })

    it("does not match a different hour", () => {
      const now = new Date("2026-01-15T14:00:00Z")
      expect(doesScheduleMatchNow({ day: 4, time: "15:00", tz: "UTC" }, now)).toBe(false)
    })

    it("defaults to UTC when tz is null", () => {
      const now = new Date("2026-01-15T14:00:00Z")
      expect(doesScheduleMatchNow({ day: 4, time: "14:00", tz: null }, now)).toBe(true)
    })

    it("honors the wall-clock hour in a non-UTC timezone during standard time (EST, UTC-5)", () => {
      // 2026-01-15 14:00 UTC = 09:00 EST (Thursday, winter — no DST)
      const now = new Date("2026-01-15T14:00:00Z")
      expect(doesScheduleMatchNow({ day: 4, time: "09:00", tz: "America/New_York" }, now)).toBe(true)
    })

    it("honors the wall-clock hour in a non-UTC timezone during daylight time (EDT, UTC-4)", () => {
      // 2026-07-15 13:00 UTC = 09:00 EDT (Wednesday, summer — DST in effect).
      // Same "09:00" schedule as the EST case above, different UTC offset —
      // proves the match is against local wall-clock time, not a fixed
      // UTC-offset calculation that would silently drift wrong across DST.
      const now = new Date("2026-07-15T13:00:00Z")
      expect(doesScheduleMatchNow({ day: 3, time: "09:00", tz: "America/New_York" }, now)).toBe(true)
    })

    it("rolls the weekday over correctly when the timezone crosses a UTC date boundary", () => {
      // 2026-01-15 20:00 UTC (Thursday) = 2026-01-16 05:00 JST (Friday)
      const now = new Date("2026-01-15T20:00:00Z")
      expect(doesScheduleMatchNow({ day: 5, time: "05:00", tz: "Asia/Tokyo" }, now)).toBe(true)
      expect(doesScheduleMatchNow({ day: 4, time: "05:00", tz: "Asia/Tokyo" }, now)).toBe(false)
    })

    it("returns false (not throw) for an invalid timezone", () => {
      const now = new Date("2026-01-15T14:00:00Z")
      expect(doesScheduleMatchNow({ day: 4, time: "14:00", tz: "Not/A_Timezone" }, now)).toBe(false)
    })
  })
})
