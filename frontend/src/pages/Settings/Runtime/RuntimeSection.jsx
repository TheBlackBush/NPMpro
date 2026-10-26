import { IconInfoCircle, IconRefresh } from "@tabler/icons-react";
import { Form, Formik, useFormikContext } from "formik";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Button, ErrorAlert, FormErrorNote, Loading } from "src/components";
import { LeaveGuard, useRuntimeSettings, useSaveRuntimeSettings } from "src/hooks";
import { intl, T } from "src/locale";
import { formatApiError } from "src/modules/ApiError";
import {
	appliesMessageId,
	fieldOfError,
	isEmptyPayload,
	isRestartField,
	isRestartPending,
	restartPendingFields,
	runtimeSettingsPayload,
} from "src/modules/RuntimeSettings";
import { showError, showObjectSuccess } from "src/notifications";
import { StatusAlert } from "../StatusAlert";

const camel = (s) => s.replaceAll(/_(?<c>[a-z])/gu, (...m) => m.at(-1).c.toUpperCase());
const hasMessage = (id) => Boolean(intl.messages[id]);
const formatMessage = (id, values) => intl.formatMessage({ id }, values);

const RuntimeContext = createContext(null);
// lock reasons of a setting, not of an env var (backend SETTING_LOCK_REASONS)
const SETTING_LOCK_REASONS = new Set(["goaccess-setting"]);

/**
 * The loaded group inside a RuntimeSection: data, isLocked(key), envOf(key) (the env var that locks it),
 * reasonOf(key) (why another setting's env var locks it, null for a direct lock), appliesId(key), isRestart(key)
 * (applies after a container restart) and restartPending(key) (saved, applies at the next container start)
 * (camelCase keys)
 */
const useRuntimeSection = () => useContext(RuntimeContext);

/**
 * The context value for a loaded group (exported for sections that hold more than one form, like Logs & monitoring)
 */
const runtimeContextOf = (group, data) => {
	const locked = new Set((data.locked ?? []).map(camel));
	return {
		group,
		data,
		// locked by an env var (the "set by environment variables" notice): not the locks of a setting
		anyLocked: (data.locked ?? []).some((key) => !SETTING_LOCK_REASONS.has(data.lockedReason?.[camel(key)])),
		isLocked: (key) => locked.has(key),
		// locked_by: the env var that locks each key (its keys camelized by base.js, the values are env names)
		envOf: (key) => data.lockedBy?.[key],
		// locked_reason: only the keys locked by another setting's env var
		reasonOf: (key) => data.lockedReason?.[key] ?? null,
		appliesId: (key) => appliesMessageId(data.applies, key),
		isRestart: (key) => isRestartField(data.applies, key),
		restartPending: (key) => isRestartPending(data.restartPending, key),
	};
};

/**
 * "Restart the container to apply: <labels>." while restart settings of the group are saved with another value than
 * the container runs with
 */
function RestartPendingAlert({ data }) {
	const fields = restartPendingFields(data.restartPending);
	if (fields.length === 0) return null;
	const labels = fields.map(({ key, labelId }) => (labelId ? intl.formatMessage({ id: labelId }) : key));
	return (
		<StatusAlert
			variant="orange"
			icon={IconRefresh}
			id="settings.runtime.restart-pending"
			data={{ fields: intl.formatList(labels, { type: "conjunction" }) }}
		/>
	);
}

function Heading({ titleId }) {
	return (
		<h2 className="mb-3">
			<T id={titleId} />
		</h2>
	);
}

/**
 * The message of a failed save, after an optional lead line; nginx -t output keeps its line breaks
 */
function SaveErrorContent({ message, lead }) {
	const [first, ...rest] = String(message).split("\n");
	return (
		<>
			{lead ? <span className="d-block">{lead}</span> : null}
			<span className="text-break">{first}</span>
			{rest.length > 0 ? (
				// Tabler's .text-wrap is white-space: normal, which would collapse the nginx output
				<pre className="mt-2 mb-0 overflow-auto text-break" style={{ whiteSpace: "pre-wrap" }}>
					{rest.join("\n")}
				</pre>
			) : null}
		</>
	);
}

function SaveButton({ group, toApi, data }) {
	const { isSubmitting, isValid, values } = useFormikContext();
	// an invalid value is not in the payload: Save stays clickable then, so that clicking it shows what to fix
	const unchanged = isValid && isEmptyPayload(runtimeSettingsPayload(group, toApi(values), data.locked, data));
	return (
		<Button type="submit" color="teal" isLoading={isSubmitting} disabled={isSubmitting || unchanged}>
			<T id="save" />
		</Button>
	);
}

/**
 * Inline alert for save errors that moves the focus to itself when it opens
 */
function useSaveError() {
	const [errorMsg, setErrorMsg] = useState(null);
	const errorRef = useRef(null);
	useEffect(() => {
		if (!errorMsg) return;
		errorRef.current?.scrollIntoView({ block: "nearest" });
		errorRef.current?.focus();
	}, [errorMsg]);
	const alert = (
		<div ref={errorRef} tabIndex={-1}>
			<ErrorAlert onClose={() => setErrorMsg(null)}>{errorMsg}</ErrorAlert>
		</div>
	);
	return { alert, setErrorMsg };
}

/**
 * Shows a failed save: inline (with nginx -t output), as a toast, and on the field the backend names (then without
 * the backend's "key_name: " prefix)
 *
 * @param {string}    group
 * @param {unknown}   err
 * @param {Object}    show
 * @param {Function}  show.setErrorMsg      the inline alert setter (useSaveError)
 * @param {Function}  [show.setFieldError]  Formik's
 * @param {*}         [show.lead]           shown above the message
 */
const reportSaveError = (group, err, { setErrorMsg, setFieldError, lead }) => {
	const { message } = formatApiError(err, hasMessage, formatMessage);
	const field = fieldOfError(group, message);
	const text = field ? field.message : message;
	setErrorMsg(<SaveErrorContent message={text} lead={lead} />);
	showError(<SaveErrorContent message={text} lead={lead} />);
	if (field && setFieldError) setFieldError(field.key, field.message);
};

/**
 * One runtime settings section (Settings > Certificates & TLS, Network, Forward authentication, Advanced): heading,
 * loading and error states, the env lock notice, the form and its Save button. Only changed, unlocked keys are sent.
 *
 * @param {Object}    props
 * @param {string}    props.group     runtime settings group
 * @param {string}    props.titleId   heading translation id
 * @param {Function}  props.toForm    (data) => Formik initial values
 * @param {Function}  props.toApi     (form values) => API values (camelCase, comparable with the loaded data)
 * @param {Function}  [props.validate]
 * @param {*}         props.children  the fields
 */
function RuntimeSection({ group, titleId, toForm, toApi, validate, children }) {
	const { data, isPending, error } = useRuntimeSettings(group);
	const { mutateAsync: save } = useSaveRuntimeSettings(group);
	const { alert, setErrorMsg } = useSaveError();

	if (error || isPending) {
		return (
			<div className="card-body">
				<Heading titleId={titleId} />
				{error ? <ErrorAlert error={error} /> : <Loading noLogo />}
			</div>
		);
	}

	const ctx = runtimeContextOf(group, data);

	const onSubmit = async (values, { setSubmitting, setFieldError }) => {
		setErrorMsg(null);
		const payload = runtimeSettingsPayload(group, toApi(values), data.locked, data);
		try {
			if (!isEmptyPayload(payload)) {
				await save(payload);
				showObjectSuccess("setting", "saved");
			}
		} catch (err) {
			reportSaveError(group, err, { setErrorMsg, setFieldError });
		}
		setSubmitting(false);
	};

	return (
		<RuntimeContext.Provider value={ctx}>
			<Formik enableReinitialize initialValues={toForm(data)} validate={validate} onSubmit={onSubmit}>
				<Form className="d-flex flex-column flex-fill" noValidate>
					<div className="card-body flex-fill">
						<Heading titleId={titleId} />
						{alert}
						{ctx.anyLocked ? (
							<StatusAlert
								variant="info"
								icon={IconInfoCircle}
								id="settings.authentication.status.locked"
							/>
						) : null}
						<RestartPendingAlert data={data} />
						{children}
					</div>
					<div className="card-footer text-end">
						<LeaveGuard />
						<FormErrorNote className="me-3" />
						<SaveButton group={group} toApi={toApi} data={data} />
					</div>
				</Form>
			</Formik>
		</RuntimeContext.Provider>
	);
}

/**
 * A titled group of fields inside a section
 */
function Part({ titleId, children, last = false }) {
	return (
		<div className={last ? undefined : "mb-4"}>
			<h3 className="card-title">
				<T id={titleId} />
			</h3>
			{children}
		</div>
	);
}

export {
	Part,
	RestartPendingAlert,
	RuntimeContext,
	RuntimeSection,
	reportSaveError,
	runtimeContextOf,
	useRuntimeSection,
	useSaveError,
};
