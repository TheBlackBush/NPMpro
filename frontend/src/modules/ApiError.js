/**
 * Message and command output for an error thrown by src/api/backend/base.js
 *
 * @param {unknown} err
 * @param {(id: string) => boolean} hasMessage   true when a translation id exists
 * @param {(id: string) => string} formatMessage
 * @returns {{ message: string, output: string|null }}
 */
export function formatApiError(err, hasMessage, formatMessage) {
	const apiError = err?.payload?.error;
	const output = typeof apiError?.output === "string" && apiError.output !== "" ? apiError.output : null;
	if (apiError?.message_i18n && hasMessage(apiError.message_i18n)) {
		return { message: formatMessage(apiError.message_i18n), output };
	}
	if (apiError?.message) {
		return { message: apiError.message, output };
	}
	// errors raised by the client itself (no payload) carry a translation id as message
	const own = err?.message ?? "";
	return { message: own && hasMessage(own) ? formatMessage(own) : own, output };
}
