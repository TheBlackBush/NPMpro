import { IconArrowsExchange, IconPlugConnected } from "@tabler/icons-react";
import cn from "clsx";
import { useId, useState } from "react";
import { useFormContext, useFormState, useWatch } from "react-hook-form";
import {
	ApiErrorContent,
	Button,
	ErrorAlert,
	FormErrorNote,
	focusFirstError,
	HookForm,
	PasswordInput,
	SwitchField,
	useAppForm,
	useFieldOrder,
	useRecheckDependent,
} from "src/components";
import { useTestDatabase } from "src/hooks";
import { intl, T } from "src/locale";
import { showDatabaseMoveModal } from "src/modals";
import {
	changeEngine,
	ENGINES,
	failedStepOf,
	initialTarget,
	moveAsApiError,
	moveHint,
	canMove as passed,
	payloadKey,
	stepName,
	targetErrors,
	testOfValues,
	toPayload,
} from "src/modules/DatabaseMove";
import { numberInputValue } from "src/modules/FormFields";
import { errorPaths, translateErrors } from "src/modules/HookForm";

// every field of the target, for the test result that belongs to exactly these values
const TARGET_FIELDS = Object.keys(initialTarget());
// the fields with rules, hidden for SQLite (their messages go with them)
const SERVER_FIELDS = ["host", "port", "name", "user"];

/**
 * The last move failed (kept in memory until the backend restarts): its step and error, so a failure nobody watched
 * is seen; it can be hidden for this page view
 */
function LastFailedMove({ move }) {
	const [hidden, setHidden] = useState(false);
	if (hidden || move?.state !== "failed") return null;
	return (
		<ErrorAlert className="mb-3" onClose={() => setHidden(true)}>
			<div className="fw-medium">
				<T
					id="settings.database.move.failed"
					data={{ step: stepName(failedStepOf(move), (id) => intl.formatMessage({ id })) }}
				/>
			</div>
			<ApiErrorContent error={moveAsApiError(move.error)} />
		</ErrorAlert>
	);
}

// an error shows once the field was left or a test was tried
function InputField({ name, id, labelId, className, required, registerOptions, ...inputProps }) {
	const { register } = useFormContext();
	const { errors } = useFormState({ name, exact: true });
	const error = errors[name]?.message ?? null;
	return (
		<div className={className}>
			<label htmlFor={id} className="form-label">
				<T id={labelId} />
			</label>
			<input
				{...register(name, registerOptions)}
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
}

function SwitchRow({ name, id, labelId }) {
	const { register } = useFormContext();
	return <SwitchField {...register(name)} id={id} className="mb-2" label={<T id={labelId} />} />;
}

function ServerFields({ baseId }) {
	const { register } = useFormContext();
	const [engine, sslEnabled] = useWatch({ name: ["engine", "sslEnabled"] });
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
					// a number, as changeEngine compares it with the engines' default ports
					registerOptions={{ setValueAs: numberInputValue }}
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
					<PasswordInput
						{...register("password")}
						id={`${baseId}-password`}
						label={<T id="settings.database.password" />}
						autoComplete="new-password"
					/>
				</div>
			</div>
			<SwitchRow name="sslEnabled" id={`${baseId}-ssl`} labelId="settings.database.ssl" />
			{engine === "mysql" && sslEnabled ? (
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
	const { register, getValues, setValue, clearErrors, setFocus } = useFormContext();
	const { isSubmitting, errors } = useFormState();
	const order = useFieldOrder();
	const recheckPort = useRecheckDependent("port");
	const list = useWatch({ name: TARGET_FIELDS });
	const values = Object.fromEntries(TARGET_FIELDS.map((name, index) => [name, list[index]]));
	const baseId = useId();
	const noteId = `${baseId}-note`;
	const hintId = `${baseId}-hint`;
	const testId = `${baseId}-test`;
	const blocked = errorPaths(errors).length > 0;
	// a result belongs to the values it was made with: any change hides it and asks for a new test
	const current = testOfValues(tested, values);
	const canMove = passed(current) && !isSubmitting;
	const hint = isSubmitting ? null : moveHint(current);

	// the port follows the engine while it is still the old engine's default; SQLite hides the server fields
	const onEngine = (event) => {
		const engine = event.target.value;
		setValue("port", changeEngine({ engine: values.engine, port: getValues("port") }, engine).port, {
			shouldDirty: true,
		});
		recheckPort();
		if (engine === "sqlite") clearErrors(SERVER_FIELDS);
	};

	return (
		<>
			<div className="card-header">
				<h3 className="card-title">
					<T id="settings.database.move" />
				</h3>
			</div>
			<div className="card-body">
				<LastFailedMove move={status?.move} />
				<p className="text-secondary">
					<T id="settings.database.move.intro" />
				</p>
				<div className="mb-3">
					<label htmlFor={`${baseId}-engine`} className="form-label">
						<T id="settings.database.engine" />
					</label>
					<select
						{...register("engine", { onChange: onEngine })}
						id={`${baseId}-engine`}
						className="form-select"
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
				<FormErrorNote id={noteId} className="me-2 text-end" />
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
					onBlockedClick={(e) => focusFirstError(e.currentTarget.closest("form"), errors, order, setFocus)}
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
		</>
	);
}

// field errors as translated text
const validate = (values) => translateErrors(targetErrors(values), intl);

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
	const [defaultValues] = useState(() => initialTarget());
	const methods = useAppForm({ defaultValues, validate });

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
		<HookForm methods={methods} onSubmit={onSubmit} className="card mb-4">
			<MoveForm tested={tested} status={status} />
		</HookForm>
	);
}

export { MoveCard };
