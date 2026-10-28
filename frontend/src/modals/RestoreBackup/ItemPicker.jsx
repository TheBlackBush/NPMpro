import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ItemChecklist } from "src/components";
import { intl, T } from "src/locale";
import { focusLeavesPicker, inSentence, mouseLeavesPicker } from "src/modules/BackupMerge";

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

	// measured on open and again when the window is resized; the shift in place is taken out of the measure
	const shiftRef = useRef(0);
	useLayoutEffect(() => {
		const measure = () => {
			const menu = ref.current;
			if (!menu) return;
			const box = (menu.closest(".modal-body") ?? document.body).getBoundingClientRect();
			const rect = menu.getBoundingClientRect();
			const left = rect.left - shiftRef.current;
			const right = rect.right - shiftRef.current;
			shiftRef.current = Math.max(Math.min(0, box.right - right), box.left - left);
			setShift(shiftRef.current);
		};
		measure();
		window.addEventListener("resize", measure);
		return () => window.removeEventListener("resize", measure);
	}, []);

	// focus moves into the search once, on open
	useEffect(() => searchRef.current?.focus(), []);

	// While open, Escape closes the picker, not the dialog, wherever the focus is. Tabler's dropdown script handles
	// Escape and the arrow keys in every .dropdown-menu on the document (capture phase) and fails without its own
	// toggle, so these keys are taken first.
	useEffect(() => {
		const onKey = (e) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				e.preventDefault();
				onClose(true);
			} else if (["ArrowUp", "ArrowDown"].includes(e.key) && ref.current?.contains(e.target)) {
				e.stopPropagation();
			}
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [onClose]);

	// a press outside the picker (other than on its button) or the focus moving to a focusable element outside it
	// closes it; the focus falling back on the dialog (a click on a row's label text) does not
	useEffect(() => {
		const onPointer = (e) => mouseLeavesPicker(e.target, ref.current, opener) && onClose(false);
		const onFocus = (e) => focusLeavesPicker(e.target, ref.current, opener) && onClose(false);
		document.addEventListener("mousedown", onPointer);
		document.addEventListener("focusin", onFocus);
		return () => {
			document.removeEventListener("mousedown", onPointer);
			document.removeEventListener("focusin", onFocus);
		};
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
				label={label}
				searchRef={searchRef}
				footer={
					<button
						type="button"
						className="btn btn-sm btn-primary ms-auto"
						onClick={() => onClose(true)}
						disabled={disabled}
					>
						<T id="settings.backup.done" />
					</button>
				}
			/>
		</div>
	);
}
