import { useFormContext } from "react-hook-form";
import { applyChanges } from "src/modules/HookForm";
import { hiddenTlsFields, tlsChanges } from "src/modules/HostForms";
import { useRecheckDependent } from "./HookForm";

/**
 * A change on the TLS tab of a React Hook Form host window, called after the field's own controller set its value:
 * sets what it turns off or on (HostForms.js tlsChanges), drops the messages of the fields it hides, and re-checks the
 * domain names, whose rule follows the certificate and the DNS challenge
 *
 * @param   {Object}  [options]
 * @param   {boolean} [options.forHttp]  false for a stream
 * @returns {Function} (name, value) => void
 */
export function useTlsChange({ forHttp = true } = {}) {
	const { getValues, setValue, clearErrors } = useFormContext();
	const recheckDomainNames = useRecheckDependent("domainNames");
	return (name, value) => {
		const values = getValues();
		const changes = tlsChanges(values, name, value, { forHttp });
		// the changed field is already set, unless the change overrides it (an mTLS certificate forces HTTPS)
		const dependents = Object.fromEntries(
			Object.entries(changes).filter(([key, next]) => key !== name || next !== value),
		);
		applyChanges(setValue, dependents);
		clearErrors(hiddenTlsFields({ ...values, ...changes }, { forHttp }));
		if ("certificateId" in changes || "npmproDnsChallenge" in changes) recheckDomainNames();
	};
}
