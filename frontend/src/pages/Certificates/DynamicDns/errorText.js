import { formatDateTime, intl } from "src/locale";
import { ddnsErrorOf } from "src/modules/DdnsForms";

/**
 * The error of a record or of the public address as text: the translated message (the time of a cooldown shown as a
 * local date and time) or the provider's own text; null without an error.
 *
 * @param   {Object | null}  item  a record or a family of the status
 * @returns {string | null}
 */
export function ddnsErrorText(item) {
	const error = ddnsErrorOf(item);
	if (error === null) return null;
	if (error.text !== undefined) return error.text;
	const values = { ...error.values };
	if (typeof values.next_write_on === "string") values.next_write_on = formatDateTime(values.next_write_on);
	return intl.formatMessage({ id: error.id }, values);
}
