// When a backup schedule is due (spec "Timing"). Pure: the zone is passed in; the backend uses the process time zone
// (TZ), the frontend copy (src/modules/ScheduleTime.js) the server's zone through Intl.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// a monthly day 28 is at most two months away
const MAX_DAYS = 62;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/u;
const FREQUENCIES = ["hours", "daily", "weekly", "monthly"];

const localZone = {
	parts: (date) => ({
		year: date.getFullYear(),
		month: date.getMonth(),
		day: date.getDate(),
		hours: date.getHours(),
		minutes: date.getMinutes(),
		weekday: date.getDay(),
	}),
	// Date takes the first occurrence of a repeated time and moves a time in a gap past the gap
	instant: (year, month, day, hours, minutes) => new Date(year, month, day, hours, minutes, 0, 0),
};

const wallKey = ({ year, month, day, hours, minutes }) => Date.UTC(year, month, day, hours, minutes);

/**
 * The instant of a wall time in the zone: a time that occurs twice is its first occurrence, a time that does not
 * exist (spring forward) is the first minute after it
 */
const wallTime = (zone, year, month, day, hours, minutes) => {
	const wanted = Date.UTC(year, month, day, hours, minutes);
	let at = zone.instant(year, month, day, hours, minutes);
	while (wallKey(zone.parts(new Date(at.getTime() - MINUTE))) >= wanted) at = new Date(at.getTime() - MINUTE);
	return at;
};

// weekday: 0 = Monday in a schedule, 0 = Sunday in Date
const isRunDay = (schedule, day) =>
	schedule.frequency === "daily" ||
	(schedule.frequency === "weekly" && day.weekday === (schedule.weekday + 1) % 7) ||
	(schedule.frequency === "monthly" && day.day === schedule.month_day);

/**
 * @param   {Object}  schedule  { frequency, every_hours, time, weekday, month_day, last_run_at }
 * @param   {Date}    after
 * @param   {Object}  [zone]    localZone or the frontend's zoneOf(timeZone)
 * @returns {Date}    the first due time strictly after `after`
 */
const nextRun = (schedule, after, zone = localZone) => {
	const afterMs = after.getTime();
	if (schedule.frequency === "hours") {
		const step = schedule.every_hours * HOUR;
		const base = schedule.last_run_at ? new Date(schedule.last_run_at).getTime() : afterMs;
		const steps = Math.max(1, Math.floor((afterMs - base) / step) + 1);
		return new Date(base + steps * step);
	}
	const [, hours, minutes] = TIME.exec(String(schedule.time));
	const start = zone.parts(after);
	for (let offset = 0; offset <= MAX_DAYS; offset++) {
		// noon is never in a gap, so it names the calendar day
		const day = zone.parts(zone.instant(start.year, start.month, start.day + offset, 12, 0));
		if (!isRunDay(schedule, day)) continue;
		const at = wallTime(zone, day.year, day.month, day.day, Number(hours), Number(minutes));
		if (at.getTime() > afterMs) return at;
	}
	throw new Error(`No run time for the schedule within ${MAX_DAYS} days`);
};

export { FREQUENCIES, localZone, nextRun, TIME, wallTime };
