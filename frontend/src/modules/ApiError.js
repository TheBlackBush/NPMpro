const HTTP_FALLBACK = /^HTTP (?<status>\d+)$/u;

/**
 * Message and command output for an error thrown by src/api/backend/base.js
 *
 * @param {unknown} err
 * @param {(id: string) => boolean} hasMessage   true when a translation id exists
 * @param {(id: string, values?: Record<string, unknown>) => string} formatMessage
 * @returns {{ message: string, output: string|null }}
 */
export function formatApiError(err, hasMessage, formatMessage) {
	const apiError = err?.payload?.error;
	const output = typeof apiError?.output === "string" && apiError.output !== "" ? apiError.output : null;
	if (apiError?.message_i18n && hasMessage(apiError.message_i18n)) {
		return { message: formatMessage(apiError.message_i18n, apiError.message_values), output };
	}
	if (apiError?.message) {
		return { message: apiError.message, output };
	}
	// errors raised by the client itself (no payload) carry a translation id as message
	const own = err?.message ?? "";
	// non-JSON responses (proxy errors, timeouts) are reported by base.js as "HTTP <status>"
	const httpStatus = HTTP_FALLBACK.exec(own);
	if (httpStatus) {
		return { message: formatMessage("error.request-failed", { status: httpStatus.groups.status }), output };
	}
	return { message: own && hasMessage(own) ? formatMessage(own) : own, output };
}

/**
 * The row a request saved although it answered an error (nginx could not reload after the save): its id and, for a
 * host, its certificate id, so a window can switch to edit mode. null for every other error.
 *
 * @param   {unknown} err
 * @returns {{ id: number, certificateId: number|undefined }|null}
 */
export function savedOf(err) {
	const apiError = err?.payload?.error;
	if (!Number.isInteger(apiError?.saved_id)) return null;
	const certificateId = Number.isInteger(apiError.saved_certificate_id) ? apiError.saved_certificate_id : undefined;
	return { id: apiError.saved_id, certificateId };
}
