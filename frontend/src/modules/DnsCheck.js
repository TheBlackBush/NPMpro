// What the DNS credential Test shows: the badge tone and text of an answer of POST /nginx/dns-credentials/{id}/test
// and whether the Test button may run. Pure.

const ID = "dns-credentials.test";
const TONES = {
	works: "success",
	"wrong-key": "destructive",
	"missing-right": "destructive",
	refused: "destructive",
	failed: "warning",
	unreachable: "warning",
	blocked: "warning",
};

/**
 * @param   {{ supported: boolean, state: string|null, needs: string|null, message: string|null }|undefined} answer
 *          the answer in camelCase
 * @returns {{ state: string, tone: "success"|"destructive"|"warning"|"muted", messageId: string,
 *            values: Object, detail: string|null }|null}  null before an answer
 *          detail: the provider's own (scrubbed) message, never for works
 */
export function testStateOf(answer) {
	if (!answer) return null;
	if (!answer.supported) {
		return { state: "unsupported", tone: "muted", messageId: `${ID}.unsupported`, values: {}, detail: null };
	}
	// a state this version does not know reads as the general failure
	const known = Object.hasOwn(TONES, answer.state);
	const state = known ? answer.state : "failed";
	// a missing right names the right; without one the general refusal is shown
	const named = state === "missing-right" && typeof answer.needs === "string" && answer.needs !== "";
	const shown = state === "missing-right" && !named ? "refused" : state;
	return {
		state,
		tone: TONES[state],
		messageId: `${ID}.${shown}`,
		values: named ? { hint: answer.needs } : {},
		detail:
			state !== "works" && typeof answer.message === "string" && answer.message !== "" ? answer.message : null,
	};
}

/**
 * Whether the Test button may run, and why not
 *
 * @param   {{ supported: boolean, dirty: boolean }} options  supported: the provider has a read call to test with;
 *          dirty: the form holds a change that is not saved (the test reads the saved values)
 * @returns {{ disabled: boolean, reasonId: string|null }}
 */
export function testAvailability({ supported, dirty }) {
	if (!supported) return { disabled: true, reasonId: `${ID}.unsupported` };
	if (dirty) return { disabled: true, reasonId: `${ID}.save-first` };
	return { disabled: false, reasonId: null };
}
