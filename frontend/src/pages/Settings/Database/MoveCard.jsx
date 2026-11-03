import { ArrowLeftRight, CircleCheck, Info, PlugZap } from "lucide-react";
import { useId, useState } from "react";
import { useFormContext, useFormState, useWatch } from "react-hook-form";
import {
	ApiErrorContent,
	Button,
	ErrorAlert,
	FormErrorNote,
	focusFirstError,
	HookForm,
	PasswordField,
	SelectField,
	SwitchField,
	SwitchList,
	TextField,
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
import { SettingsCard } from "../SettingsCard";
import { StatusAlert } from "../StatusAlert";

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
		<ErrorAlert onClose={() => setHidden(true)}>
			<div className="font-medium">
				<T
					id="settings.database.move.failed"
					data={{ step: stepName(failedStepOf(move), (id) => intl.formatMessage({ id })) }}
				/>
			</div>
			<ApiErrorContent error={moveAsApiError(move.error)} />
		</ErrorAlert>
	);
}

// a field of the target on the form layer's TextField (its error shows once the field was left or a test was tried)
function InputField({ name, id, labelId, className, required, registerOptions, ...inputProps }) {
	return (
		<TextField
			{...inputProps}
			name={name}
			id={id}
			label={<T id={labelId} />}
			required={required}
			className={className}
			registerOptions={registerOptions}
		/>
	);
}

function SwitchRow({ name, id, labelId }) {
	const { register } = useFormContext();
	return <SwitchField {...register(name)} id={id} label={<T id={labelId} />} />;
}

function ServerFields({ baseId }) {
	const [engine, sslEnabled] = useWatch({ name: ["engine", "sslEnabled"] });
	return (
		<>
			<div className="grid gap-2 md:grid-cols-12">
				<InputField
					name="host"
					id={`${baseId}-host`}
					labelId="settings.database.host"
					className="md:col-span-8"
					required
					autoComplete="off"
					spellCheck={false}
				/>
				<InputField
					name="port"
					id={`${baseId}-port`}
					labelId="settings.database.port"
					className="md:col-span-4"
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
					className="md:col-span-6"
					required
					autoComplete="off"
					spellCheck={false}
				/>
				<InputField
					name="user"
					id={`${baseId}-user`}
					labelId="settings.database.user"
					className="md:col-span-6"
					required
					autoComplete="off"
					spellCheck={false}
				/>
				<PasswordField
					name="password"
					id={`${baseId}-password`}
					label={<T id="settings.database.password" />}
					autoComplete="new-password"
					className="md:col-span-12"
				/>
			</div>
			<SwitchList>
				<SwitchRow name="sslEnabled" id={`${baseId}-ssl`} labelId="settings.database.ssl" />
				{engine === "mysql" && sslEnabled ? (
					<SwitchRow
						name="sslRejectUnauthorized"
						id={`${baseId}-ssl-reject`}
						labelId="settings.database.ssl.reject-unauthorized"
					/>
				) : null}
				{engine === "mysql" && sslEnabled ? (
					<SwitchRow
						name="sslVerifyIdentity"
						id={`${baseId}-ssl-identity`}
						labelId="settings.database.ssl.verify-identity"
					/>
				) : null}
			</SwitchList>
		</>
	);
}

/**
 * @param {Object} props
 * @param {?{ key: string, result?: Object, error?: unknown }} props.tested  the last test and the values it used
 * @param {Object} props.status  GET /database, for the move window's summary
 */
function MoveForm({ tested, status }) {
	const { getValues, setValue, clearErrors, setFocus } = useFormContext();
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
		<SettingsCard
			title={<T id="settings.database.move" />}
			footer={
				<>
					<FormErrorNote id={noteId} className="text-right" />
					{hint && !blocked ? (
						<span id={hintId} className="text-right text-sm text-muted-foreground">
							<T id={hint} />
						</span>
					) : null}
					<Button
						type="submit"
						id={testId}
						isLoading={isSubmitting}
						blocked={blocked}
						onBlockedClick={() => focusFirstError(errors, order, setFocus)}
						// keeps the focus in the field until the click is done (a blur error would move the button)
						onMouseDown={(e) => e.preventDefault()}
						aria-describedby={blocked ? noteId : undefined}
					>
						<PlugZap aria-hidden="true" />
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
						<ArrowLeftRight aria-hidden="true" />
						<T id="settings.database.move.button" />
					</Button>
				</>
			}
		>
			<LastFailedMove move={status?.move} />
			<p className="text-muted-foreground">
				<T id="settings.database.move.intro" />
			</p>
			<SelectField
				name="engine"
				id={`${baseId}-engine`}
				label={<T id="settings.database.engine" />}
				registerOptions={{ onChange: onEngine }}
			>
				{ENGINES.map((engine) => (
					<option key={engine} value={engine}>
						{intl.formatMessage({ id: `settings.database.engine.${engine}` })}
					</option>
				))}
			</SelectField>
			{values.engine === "sqlite" ? (
				<StatusAlert variant="info" icon={Info} id="settings.database.move.sqlite-note" />
			) : (
				<ServerFields baseId={baseId} />
			)}
			{/* always mounted, so a screen reader announces the result that appears in it */}
			<div aria-live="polite">
				{current?.result ? (
					<StatusAlert variant="success" icon={CircleCheck} live={false}>
						{current.result.engine === "sqlite" ? (
							<T id="settings.database.test.ok-sqlite" />
						) : (
							<T id="settings.database.test.ok" data={{ version: current.result.version ?? "" }} />
						)}
					</StatusAlert>
				) : null}
			</div>
			{/* outside the polite region: the alert's own role="alert" announces it once */}
			{current?.error ? (
				<ErrorAlert>
					<ApiErrorContent error={current.error} />
				</ErrorAlert>
			) : null}
		</SettingsCard>
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
		<HookForm methods={methods} onSubmit={onSubmit}>
			<MoveForm tested={tested} status={status} />
		</HookForm>
	);
}

export { MoveCard };
