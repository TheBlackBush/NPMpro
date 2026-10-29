import { IconArrowsExchange, IconPlugConnected } from "@tabler/icons-react";
import cn from "clsx";
import { Field, Form, Formik, useFormikContext } from "formik";
import { useId, useState } from "react";
import {
	ApiErrorContent,
	Button,
	ErrorAlert,
	FormErrorNote,
	PasswordInput,
	SwitchField,
	showFirstInvalid,
	useShownErrors,
} from "src/components";
import { useTestDatabase } from "src/hooks";
import { intl, T } from "src/locale";
import { showDatabaseMoveModal } from "src/modals";
import {
	changeEngine,
	ENGINES,
	initialTarget,
	moveHint,
	canMove as passed,
	payloadKey,
	targetErrors,
	testOfValues,
	toPayload,
} from "src/modules/DatabaseMove";

// an error is shown once the field was left or a test was tried
const shownError = (form, name) =>
	form.errors[name] && (form.touched[name] || form.submitCount > 0) ? form.errors[name] : null;

function InputField({ name, id, labelId, className, required, ...inputProps }) {
	return (
		<Field name={name}>
			{({ field, form }) => {
				const error = shownError(form, name);
				return (
					<div className={className}>
						<label htmlFor={id} className="form-label">
							<T id={labelId} />
						</label>
						<input
							{...field}
							{...inputProps}
							id={id}
							required={required}
							aria-required={required ? "true" : undefined}
							className={cn("form-control", error && "is-invalid")}
							aria-invalid={error ? "true" : undefined}
							aria-describedby={error ? `${id}-error` : undefined}
						/>
						{error ? (
							<div className="invalid-feedback" id={`${id}-error`}>
								{error}
							</div>
						) : null}
					</div>
				);
			}}
		</Field>
	);
}

function SwitchRow({ name, id, labelId }) {
	return (
		<Field name={name} type="checkbox">
			{({ field }) => <SwitchField {...field} id={id} className="mb-2" label={<T id={labelId} />} />}
		</Field>
	);
}

function ServerFields({ baseId }) {
	const { values } = useFormikContext();
	return (
		<>
			<div className="row g-2 mb-3">
				<InputField
					name="host"
					id={`${baseId}-host`}
					labelId="settings.database.host"
					className="col-md-8"
					required
					autoComplete="off"
					spellCheck={false}
				/>
				<InputField
					name="port"
					id={`${baseId}-port`}
					labelId="settings.database.port"
					className="col-md-4"
					type="number"
					min={1}
					max={65_535}
				/>
				<InputField
					name="name"
					id={`${baseId}-name`}
					labelId="settings.database.name"
					className="col-md-6"
					required
					autoComplete="off"
					spellCheck={false}
				/>
				<InputField
					name="user"
					id={`${baseId}-user`}
					labelId="settings.database.user"
					className="col-md-6"
					required
					autoComplete="off"
					spellCheck={false}
				/>
				<div className="col-12">
					<Field name="password">
						{({ field }) => (
							<PasswordInput
								{...field}
								id={`${baseId}-password`}
								label={<T id="settings.database.password" />}
								autoComplete="new-password"
							/>
						)}
					</Field>
				</div>
			</div>
			<SwitchRow name="sslEnabled" id={`${baseId}-ssl`} labelId="settings.database.ssl" />
			{values.engine === "mysql" && values.sslEnabled ? (
				<>
					<SwitchRow
						name="sslRejectUnauthorized"
						id={`${baseId}-ssl-reject`}
						labelId="settings.database.ssl.reject-unauthorized"
					/>
					<SwitchRow
						name="sslVerifyIdentity"
						id={`${baseId}-ssl-identity`}
						labelId="settings.database.ssl.verify-identity"
					/>
				</>
			) : null}
		</>
	);
}

/**
 * @param {Object} props
 * @param {?{ key: string, result?: Object, error?: unknown }} props.tested  the last test and the values it used
 * @param {Object} props.status  GET /database, for the move window's summary
 */
function MoveForm({ tested, status }) {
	const { values, setValues, isSubmitting } = useFormikContext();
	const baseId = useId();
	const noteId = `${baseId}-note`;
	const hintId = `${baseId}-hint`;
	const testId = `${baseId}-test`;
	const blocked = useShownErrors(true).length > 0;
	// a result belongs to the values it was made with: any change hides it and asks for a new test
	const current = testOfValues(tested, values);
	const canMove = passed(current) && !isSubmitting;
	const hint = isSubmitting ? null : moveHint(current);

	return (
		<Form className="card mb-4" noValidate>
			<div className="card-header">
				<h3 className="card-title">
					<T id="settings.database.move" />
				</h3>
			</div>
			<div className="card-body">
				<p className="text-secondary">
					<T id="settings.database.move.intro" />
				</p>
				<div className="mb-3">
					<label htmlFor={`${baseId}-engine`} className="form-label">
						<T id="settings.database.engine" />
					</label>
					<select
						id={`${baseId}-engine`}
						className="form-select"
						value={values.engine}
						onChange={(event) => setValues(changeEngine(values, event.target.value))}
					>
						{ENGINES.map((engine) => (
							<option key={engine} value={engine}>
								{intl.formatMessage({ id: `settings.database.engine.${engine}` })}
							</option>
						))}
					</select>
				</div>
				{values.engine === "sqlite" ? (
					<div className="alert alert-info">
						<T id="settings.database.move.sqlite-note" />
					</div>
				) : (
					<ServerFields baseId={baseId} />
				)}
				{/* always mounted, so a screen reader announces the result that appears in it */}
				<div aria-live="polite">
					{current?.result ? (
						<div className="alert alert-success mt-3 mb-0">
							{current.result.engine === "sqlite" ? (
								<T id="settings.database.test.ok-sqlite" />
							) : (
								<T id="settings.database.test.ok" data={{ version: current.result.version ?? "" }} />
							)}
						</div>
					) : null}
				</div>
				{/* outside the polite region: the alert's own role="alert" announces it once */}
				{current?.error ? (
					<ErrorAlert className="mt-3 mb-0">
						<ApiErrorContent error={current.error} />
					</ErrorAlert>
				) : null}
			</div>
			<div className="card-footer d-flex flex-wrap align-items-center justify-content-end gap-2">
				<FormErrorNote id={noteId} late className="me-2 text-end" />
				{hint && !blocked ? (
					<span id={hintId} className="text-secondary small me-2 text-end">
						<T id={hint} />
					</span>
				) : null}
				<Button
					type="submit"
					id={testId}
					isLoading={isSubmitting}
					blocked={blocked}
					onBlockedClick={(e) => showFirstInvalid(e.currentTarget.closest("form"))}
					// keeps the focus in the field until the click is done (a blur error would move the button)
					onMouseDown={(e) => e.preventDefault()}
					aria-describedby={blocked ? noteId : undefined}
				>
					<IconPlugConnected className="icon" aria-hidden="true" />
					<T id="settings.database.test" />
				</Button>
				<Button
					color="primary"
					blocked={!canMove}
					// the next step is the test: a click on the blocked Move goes to its button
					onBlockedClick={(e) =>
						e.currentTarget
							.closest("form")
							?.querySelector(`#${CSS.escape(testId)}`)
							?.focus()
					}
					onClick={() => showDatabaseMoveModal({ status, target: toPayload(values) })}
					title={hint ? intl.formatMessage({ id: hint }) : undefined}
					aria-describedby={hint && !blocked ? hintId : undefined}
				>
					<IconArrowsExchange className="icon" aria-hidden="true" />
					<T id="settings.database.move.button" />
				</Button>
			</div>
		</Form>
	);
}

// field errors as translated text, for Formik
const validate = (values) =>
	Object.fromEntries(Object.entries(targetErrors(values)).map(([field, id]) => [field, intl.formatMessage({ id })]));

/**
 * Move to another database: the target's engine and connection, "Test connection", and "Move", which needs a passing
 * test of exactly the values in the form
 *
 * @param {Object} props
 * @param {Object} props.status  GET /database: the database in use and its tables
 */
function MoveCard({ status }) {
	const testDatabase = useTestDatabase();
	const [tested, setTested] = useState(null);

	// Enter in a field and "Test connection" both submit the form, which tests the connection
	const onSubmit = async (values) => {
		const payload = toPayload(values);
		const key = payloadKey(payload);
		try {
			const result = await testDatabase.mutateAsync(payload);
			setTested({ key, result });
		} catch (error) {
			setTested({ key, error });
		}
	};

	return (
		<Formik initialValues={initialTarget()} validate={validate} onSubmit={onSubmit}>
			<MoveForm tested={tested} status={status} />
		</Formik>
	);
}

export { MoveCard };
