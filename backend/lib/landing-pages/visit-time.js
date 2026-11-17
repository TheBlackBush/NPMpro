// Settings, Landing pages, Visit time: how the built-in pages with the time chip show the visit time. The choice is
// stored in the landing_pages row (meta.visit_time) and handed to nginx as $npmpro_visit_time by an http-level include
// (nginx.conf), which the chip echoes; data-setup.sh writes the utc file when it is missing, so nginx starts before the
// backend has written it. Pure.

export const VISIT_TIMES = ["utc", "local", "local-utc"];
export const VISIT_TIME_CONF = "/data/npmpro/nginx/landing-pages.conf";

/**
 * @param   {Object|null} stored  the landing_pages row's meta
 * @returns {"utc"|"local"|"local-utc"}  utc for a missing or unknown value
 */
export const visitTimeOf = (stored) => (VISIT_TIMES.includes(stored?.visit_time) ? stored.visit_time : "utc");

/**
 * @param   {string} value
 * @returns {string}  the include; a value that is not one of VISIT_TIMES is written as utc
 */
export const visitTimeConf = (value) =>
	`# the visit time of the built-in landing pages (Settings, Landing pages): utc, local or local-utc\nmap $host $npmpro_visit_time {\n  default "${visitTimeOf({ visit_time: value })}";\n}\n`;
