/**
 * A moment as `YYYY-MM-DD HH:MM` in UTC (24 hours, zero padded), the same in every language
 *
 * @param   {Date}  date
 * @returns {string}
 */
export const utcMinute = (date) => date.toISOString().slice(0, 16).replace("T", " ");
