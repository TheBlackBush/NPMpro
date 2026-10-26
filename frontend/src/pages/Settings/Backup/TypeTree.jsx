import { useEffect, useId, useRef } from "react";
import { T } from "src/locale";
import { categoryState, toggleCategory, toggleType } from "src/modules/BackupTypes";

// certificate providers in the order shown, with their label
const CERTIFICATE_KINDS = [
	["letsencrypt", "settings.backup.kind.letsencrypt"],
	["other", "settings.backup.kind.other"],
	["mtls", "settings.backup.kind.mtls"],
];

function Count({ value }) {
	if (value === undefined) return null;
	return <span className="badge bg-secondary-lt ms-2">{value}</span>;
}

// "Let's Encrypt: 3, Custom: 1, mTLS CAs: 0", under the certificates checkbox
function CertificateKinds({ kinds, id }) {
	if (!kinds) return null;
	return (
		<div id={id} className="form-hint ms-4 mt-n1 mb-2">
			{CERTIFICATE_KINDS.map(([kind, labelId], index) => (
				<span key={kind}>
					{index > 0 ? ", " : null}
					<T id={labelId} data={{ count: kinds[kind] ?? 0 }} />
				</span>
			))}
		</div>
	);
}

function Check({ checked, indeterminate = false, onChange, disabled, bold, label, count, describedBy }) {
	const ref = useRef(null);
	// indeterminate exists only as a DOM property
	useEffect(() => {
		if (ref.current) ref.current.indeterminate = indeterminate;
	}, [indeterminate]);
	return (
		<label className="form-check mb-2">
			<input
				ref={ref}
				className="form-check-input"
				type="checkbox"
				checked={checked}
				onChange={onChange}
				disabled={disabled}
				aria-checked={indeterminate ? "mixed" : undefined}
				aria-describedby={describedBy}
			/>
			<span className={bold ? "form-check-label fw-bold" : "form-check-label"}>
				{label}
				<Count value={count} />
			</span>
		</label>
	);
}

/**
 * The backup parts as checkboxes: a category with its types below (the category is ticked, cleared or mixed), a
 * category of one type as one checkbox. Counts per type, the certificates with their kinds when given.
 *
 * @param {Object}   props
 * @param {Array}    props.categories          [{ id, types }]
 * @param {Object}   [props.counts]            type id -> rows or files
 * @param {Object}   [props.certificateKinds]  provider -> certificates (letsencrypt, other, mtls)
 * @param {string[]} props.selected            the ticked type ids
 * @param {Function} props.onChange            (selected) => void
 * @param {boolean}  [props.disabled]
 */
function TypeTree({ categories, counts = {}, certificateKinds, selected, onChange, disabled = false }) {
	const baseId = useId();
	return (
		<div className="row">
			{categories.map((category) => {
				const groupId = `${baseId}-${category.id}`;
				const kindsId = `${groupId}-kinds`;
				const kinds = category.types.includes("certificates") ? certificateKinds : null;
				if (category.types.length === 1) {
					const [typeId] = category.types;
					return (
						<div key={category.id} className="col-12 col-md-6">
							<Check
								bold
								checked={selected.includes(typeId)}
								onChange={() => onChange(toggleType(typeId, selected))}
								disabled={disabled}
								label={<T id={`settings.backup.category.${category.id}`} />}
								count={counts[typeId]}
								describedBy={kinds ? kindsId : undefined}
							/>
							<CertificateKinds kinds={kinds} id={kindsId} />
						</div>
					);
				}
				const state = categoryState(category, selected);
				return (
					<fieldset key={category.id} className="col-12 col-md-6" aria-labelledby={groupId}>
						<Check
							bold
							checked={state === "all"}
							indeterminate={state === "some"}
							onChange={() => onChange(toggleCategory(category, selected))}
							disabled={disabled}
							label={
								<span id={groupId}>
									<T id={`settings.backup.category.${category.id}`} />
								</span>
							}
						/>
						<div className="ms-4">
							{category.types.map((typeId) => (
								<Check
									key={typeId}
									checked={selected.includes(typeId)}
									onChange={() => onChange(toggleType(typeId, selected))}
									disabled={disabled}
									label={<T id={`settings.backup.type.${typeId}`} />}
									count={counts[typeId]}
								/>
							))}
						</div>
					</fieldset>
				);
			})}
		</div>
	);
}

export { TypeTree };
