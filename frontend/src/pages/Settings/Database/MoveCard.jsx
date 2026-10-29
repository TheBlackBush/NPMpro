import { IconArrowsExchange, IconPlugConnected } from "@tabler/icons-react";
import cn from "clsx";
import { Field, Form, Formik, useFormikContext } from "formik";
import { useId, useState } from "react";
import { ApiErrorContent, Button, ErrorAlert, PasswordInput, SwitchField } from "src/components";
import { useTestDatabase } from "src/hooks";
import { intl, T } from "src/locale";
import { changeEngine, ENGINES, initialTarget, payloadKey, targetErrors, toPayload } from "src/modules/DatabaseMove";

// an error is shown once the field was left or a test was tried
const shownError = (form, name) =>
	form.errors[name] && (form.touched[name] || form.submitCount > 0) ? form.errors[name] : null;

function InputField({ name, id, labelId, className, ...inputProps }) {
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
					autoComplete="off"
					spellCheck={false}
				/>
				<InputField
					name="user"
					id={`${baseId}-user`}
					labelId="settings.database.user"
					className="col-md-6"
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
 */
function MoveForm({ tested }) {
	const { values, setValues, isSubmitting } = useFormikContext();
	const baseId = useId();
	const reasonId = `${baseId}-reason`;
	// a result belongs to the values it was made with: any change hides it and asks for a new test
	const current = tested?.key === payloadKey(toPayload(values)) ? tested : null;
	const canMove = Boolean(current?.result) && !isSubmitting;

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
				{current?.result ? (
					<div className="alert alert-success mt-3 mb-0" role="status">
						{current.result.engine === "sqlite" ? (
							<T id="settings.database.test.ok-sqlite" />
						) : (
							<T id="settings.database.test.ok" data={{ version: current.result.version ?? "" }} />
						)}
					</div>
				) : null}
				{current?.error ? (
					<ErrorAlert className="mt-3 mb-0">
						<ApiErrorContent error={current.error} />
					</ErrorAlert>
				) : null}
			</div>
			<div className="card-footer d-flex flex-wrap align-items-center justify-content-end gap-2">
				{canMove ? null : (
					<span id={reasonId} className="text-secondary small me-2 text-end">
						<T id="settings.database.test.first" />
					</span>
				)}
				<Button type="submit" isLoading={isSubmitting}>
					<IconPlugConnected className="icon" aria-hidden="true" />
					<T id="settings.database.test" />
				</Button>
				<Button
					color="primary"
					blocked={!canMove}
					title={canMove ? undefined : intl.formatMessage({ id: "settings.database.test.first" })}
					aria-describedby={canMove ? undefined : reasonId}
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
 */
function MoveCard() {
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
			<MoveForm tested={tested} />
		</Formik>
	);
}

export { MoveCard };
