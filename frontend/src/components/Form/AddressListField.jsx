import { useController } from "react-hook-form";
import { Combobox } from "src/components/Combobox";
import { intl } from "src/locale";
import { ALERT_ADDRESSES_MAX, isSingleAddress } from "src/modules/NotificationForms";
import { FormField } from "./FormField";
import { usePendingEntry, useReadOnly } from "./HookForm";

const REFUSED_CHIP = "border-destructive text-destructive";

const refusedMessage = (refused) =>
	intl.formatMessage({ id: "settings.notifications.alerts-addresses.refused" }, { address: refused.join(", ") });

/**
 * A list of plain mail addresses as chips with a text input, one line of a Settings card (line "block"): Enter, a
 * comma or a space adds the typed address, the chip's x removes one, text left in the input is added on save. A
 * typed address that is not valid stays in the input and refuses the save; a saved one that is not valid (a restored
 * backup) is marked on its chip.
 *
 * @param {Object}  props
 * @param {string}  props.name
 * @param {string}  props.id
 * @param {*}       props.label
 * @param {*}       [props.hint]
 * @param {*}       [props.badges]
 * @param {boolean} [props.disabled]
 * @param {string}  [props.placeholder]
 * @param {string|null} [props.refused]  an address the server refused: its chip is marked
 */
export function AddressListField({ name, id, label, hint, badges, disabled = false, placeholder, refused = null }) {
	const { field, fieldState } = useController({ name });
	const pending = usePendingEntry(name, refusedMessage);
	const readOnly = useReadOnly();
	const values = field.value ?? [];
	return (
		<FormField
			line="block"
			id={id}
			label={label}
			hint={hint}
			badges={badges}
			error={fieldState.error?.message ?? null}
		>
			{(control) => (
				<Combobox
					{...control}
					ref={field.ref}
					name={name}
					multiple
					creatable
					disabled={disabled || readOnly}
					value={values}
					isValidNew={(text, current) => isSingleAddress(text) && current.length < ALERT_ADDRESSES_MAX}
					createText={(text) =>
						intl.formatMessage({ id: "settings.notifications.alerts-addresses.add" }, { address: text })
					}
					emptyText={() => intl.formatMessage({ id: "settings.notifications.alerts-addresses.empty" })}
					commitRef={pending.ref}
					onQueryChange={(text) => pending.setPending(text.trim() !== "")}
					chipClassName={(entry) => (isSingleAddress(entry) && entry !== refused ? undefined : REFUSED_CHIP)}
					chipProps={(entry) =>
						isSingleAddress(entry) && entry !== refused
							? {}
							: {
									"data-address-refused": "",
									srText: intl.formatMessage({
										id: "settings.notifications.alerts-addresses.refused-chip",
									}),
								}
					}
					placeholder={placeholder}
					onBlur={field.onBlur}
					onChange={(next) => field.onChange(next)}
				/>
			)}
		</FormField>
	);
}
