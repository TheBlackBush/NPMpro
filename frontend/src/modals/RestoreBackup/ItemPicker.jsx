import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ItemChecklist } from "src/components";
import { intl, T } from "src/locale";
import { inSentence } from "src/modules/BackupMerge";

/**
 * The items of one type to tick, as a dropdown card under the type's list button: search, "Selected only", the list,
 * "Select all", "None" and Done. Closes on Done and Escape (focus back to the button) and on a click outside.
 *
 * @param {Object}      props
 * @param {string}      props.id        the menu's id, for the button's aria-controls
 * @param {string}      props.typeId
 * @param {Array}       props.items     [{ id, label }]
 * @param {Array}       props.selected  the ticked ids
 * @param {Function}    props.onChange  (ids) => void
 * @param {Function}    props.onClose   (returnFocus) => void
 * @param {HTMLElement} [props.opener]  the button that opened it (a click on it toggles, not closes from outside)
 * @param {boolean}     [props.disabled]
 */
export function ItemPicker({ id, typeId, items, selected, onChange, onClose, opener, disabled = false }) {
	const ref = useRef(null);
	const searchRef = useRef(null);
	// the shift that keeps the menu inside the dialog when its button sits near the right edge
	const [shift, setShift] = useState(0);
	const typeName = intl.formatMessage({ id: `settings.backup.type.${typeId}` });
	const label = intl.formatMessage(
		{ id: "settings.backup.choose-type" },
		{ type: inSentence(typeName, intl.locale) },
	);

	useLayoutEffect(() => {
		const menu = ref.current;
		const bound = menu?.closest(".modal-body") ?? document.body;
		if (!menu) return;
		const box = bound.getBoundingClientRect();
		const rect = menu.getBoundingClientRect();
		setShift(Math.max(Math.min(0, box.right - rect.right), box.left - rect.left));
	}, []);

	// focus moves into the search once, on open
	useEffect(() => searchRef.current?.focus(), []);

	// Escape closes the picker, not the dialog. Tabler's dropdown script handles Escape and the arrow keys in every
	// .dropdown-menu on the document (capture phase) and fails without its own toggle, so the keys are taken first.
	useEffect(() => {
		const onKey = (e) => {
			if (!ref.current?.contains(e.target) || !["Escape", "ArrowUp", "ArrowDown"].includes(e.key)) return;
			e.stopPropagation();
			if (e.key === "Escape") {
				e.preventDefault();
				onClose(true);
			}
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [onClose]);

	useEffect(() => {
		const onPointer = (e) => {
			if (ref.current?.contains(e.target) || opener?.contains(e.target)) return;
			onClose(false);
		};
		document.addEventListener("mousedown", onPointer);
		return () => document.removeEventListener("mousedown", onPointer);
	}, [onClose, opener]);

	return (
		<div
			ref={ref}
			id={id}
			role="dialog"
			aria-label={label}
			className="dropdown-menu dropdown-menu-card show"
			data-bs-popper="static"
			// no Tabler utility sets a menu width; the shift is measured
			style={{ width: "20rem", maxWidth: "calc(100vw - 48px)", left: shift }}
		>
			<ItemChecklist
				items={items}
				selected={selected}
				onChange={onChange}
				typeName={typeName}
				disabled={disabled}
				menu={true}
				searchRef={searchRef}
				footer={
					<button type="button" className="btn btn-sm btn-primary ms-auto" onClick={() => onClose(true)}>
						<T id="settings.backup.done" />
					</button>
				}
			/>
		</div>
	);
}
