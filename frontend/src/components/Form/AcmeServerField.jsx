import { useEffect } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { FormSelect } from "src/components/AppSelect";
import { useFieldError } from "src/components/Form/HookForm";
import { useAcmeServers } from "src/hooks/useAcmeServers";
import { intl, T } from "src/locale";
import { caOptions, caOptionTexts, defaultCa, showCaSelect } from "src/modules/AcmeServers";
import { FormField } from "./FormField";

/** The option of one CA for the select (caOptionTexts with the UI language) */
export const caSelectOption = (option) => caOptionTexts(option, (id, values) => intl.formatMessage({ id }, values));

/**
 * The CA of a certificate request: a select of the instance CA and the CAs an administrator set up, the instance CA
 * chosen. Hidden (and nothing sent) while the list loads or fails and when there is one CA only: the backend then uses
 * the instance CA. With `exclude` (a re-issue) it lists the other CAs, none chosen, and hides without any.
 *
 * @param {Object} [props]
 * @param {string} [props.name]
 * @param {string} [props.exclude]  a CA to leave out (the certificate's current CA)
 */
export function AcmeServerField({ name = "npmproAcmeServer", exclude }) {
	const { data } = useAcmeServers();
	const { setValue } = useFormContext();
	const value = useWatch({ name });
	const error = useFieldError(name);
	// a re-issue lists the other CAs (none chosen: the user picks), a new request every CA once there is a choice
	const others = exclude ? caOptions(data, exclude) : [];
	const shown = exclude ? others.length > 0 : showCaSelect(data);
	const first = exclude ? "" : defaultCa(data);
	useEffect(() => {
		if (shown && first && !value) setValue(name, first, { shouldDirty: false });
	}, [shown, first, value, name, setValue]);
	if (!shown) return null;
	return (
		<FormField id={name} label={<T id="settings.certificates.acme.ca" />} error={error}>
			{(control) => (
				<FormSelect
					{...control}
					name={name}
					options={caOptions(data, exclude).map(caSelectOption)}
					placeholder={exclude ? intl.formatMessage({ id: "certificates.ca.choose" }) : undefined}
				/>
			)}
		</FormField>
	);
}
