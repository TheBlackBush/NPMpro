import { formatDateTime, intl } from "src/locale";
import { ddnsApiErrorOf, ddnsErrorOf, ddnsMessageValues } from "src/modules/DdnsForms";

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
	return intl.formatMessage({ id: error.id }, ddnsMessageValues(error.values, formatDateTime));
}

/**
 * The ddns message of a failed request (Update now inside the cooldown, a paused updater) as text, the time of a
 * cooldown as a local date and time; null for any other error, which showApiError shows
 *
 * @param   {unknown}  err
 * @returns {string | null}
 */
export function ddnsApiErrorText(err) {
	const error = ddnsApiErrorOf(err, formatDateTime);
	return error === null ? null : intl.formatMessage({ id: error.id }, error.values);
}
