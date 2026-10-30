import { IconInfoCircle, IconRefresh } from "@tabler/icons-react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useWatch } from "react-hook-form";
import { ErrorAlert, HookForm, Loading, useAppForm, useFieldOrder } from "src/components";
import { useRuntimeSettings, useSaveRuntimeSettings } from "src/hooks";
import { intl, T } from "src/locale";
import { formatApiError } from "src/modules/ApiError";
import {
	appliesMessageId,
	fieldOfError,
	GROUP_KEYS,
	isEmptyPayload,
	isRestartField,
	isRestartPending,
	restartPendingFields,
	runtimeSettingsPayload,
} from "src/modules/RuntimeSettings";
import { unlockedErrors } from "src/modules/SettingsForms";
import { showError, showObjectSuccess } from "src/notifications";
import { SaveBar } from "../SaveBar";
import { StatusAlert } from "../StatusAlert";

const camel = (s) => s.replaceAll(/_(?<c>[a-z])/gu, (...m) => m.at(-1).c.toUpperCase());
const hasMessage = (id) => Boolean(intl.messages[id]);
const formatMessage = (id, values) => intl.formatMessage({ id }, values);

const RuntimeContext = createContext(null);
// lock reasons of a setting, not of an env var (backend SETTING_LOCK_REASONS)
const SETTING_LOCK_REASONS = new Set(["goaccess-setting", "force-mlkem-setting"]);

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

/**
 * Save: nothing to save while the request would be empty (no changed, unlocked key), so it reads every field of the
 * section (by name, in form order)
 */
function SaveButton({ group, toApi, data }) {
	const names = useFieldOrder();
	const list = useWatch({ name: names });
	const values = Object.fromEntries(names.map((name, index) => [name, list[index]]));
	const locked = new Set((data.locked ?? []).map(camel));
	const allLocked = (GROUP_KEYS[group] ?? []).every((key) => locked.has(key));
	return (
		<SaveBar
			disabled={isEmptyPayload(runtimeSettingsPayload(group, toApi(values), data.locked, data))}
			reasonId={allLocked ? "settings.save.all-locked" : undefined}
		/>
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
 * @param {Function}  show.setErrorMsg  the inline alert setter (useSaveError)
 * @param {Function}  [show.setError]   React Hook Form's
 * @param {*}         [show.lead]       shown above the message
 */
const reportSaveError = (group, err, { setErrorMsg, setError, lead }) => {
	const { message } = formatApiError(err, hasMessage, formatMessage);
	const field = fieldOfError(group, message);
	const text = field ? field.message : message;
	setErrorMsg(<SaveErrorContent message={text} lead={lead} />);
	showError(<SaveErrorContent message={text} lead={lead} />);
	if (field && setError) setError(field.key, { type: "server", message: field.message });
};

/**
 * The form of a loaded group: the saved settings are its values, also after a save or a refetch (new settings
 * replace every field)
 */
function RuntimeForm({ group, titleId, data, toForm, toApi, validate, children }) {
	const { mutateAsync: save } = useSaveRuntimeSettings(group);
	const { alert, setErrorMsg } = useSaveError();
	const ctx = runtimeContextOf(group, data);
	const saved = toForm(data);
	const methods = useAppForm({
		defaultValues: saved,
		values: saved,
		keepEdits: false,
		// a value set by env is the admin's (the backend takes it as it is): it never blocks saving the other fields
		validate: (values) => unlockedErrors(validate?.(values), ctx.isLocked),
	});

	const onSubmit = async (values) => {
		setErrorMsg(null);
		const payload = runtimeSettingsPayload(group, toApi(values), data.locked, data);
		try {
			if (!isEmptyPayload(payload)) {
				await save(payload);
				showObjectSuccess("setting", "saved");
			}
		} catch (err) {
			reportSaveError(group, err, { setErrorMsg, setError: methods.setError });
		}
	};

	return (
		<RuntimeContext.Provider value={ctx}>
			<HookForm methods={methods} onSubmit={onSubmit} className="d-flex flex-column flex-fill">
				<div className="card-body flex-fill">
					<Heading titleId={titleId} />
					{alert}
					{ctx.anyLocked ? (
						<StatusAlert variant="info" icon={IconInfoCircle} id="settings.authentication.status.locked" />
					) : null}
					<RestartPendingAlert data={data} />
					{children}
				</div>
				<SaveButton group={group} toApi={toApi} data={data} />
			</HookForm>
		</RuntimeContext.Provider>
	);
}

/**
 * One runtime settings section (Settings > Certificates & TLS, Network, Forward authentication, Advanced): heading,
 * loading and error states, the env lock notice, the form and its Save button. Only changed, unlocked keys are sent.
 *
 * @param {Object}    props
 * @param {string}    props.group     runtime settings group
 * @param {string}    props.titleId   heading translation id
 * @param {Function}  props.toForm    (data) => the form's values, in the order the section shows its fields
 * @param {Function}  props.toApi     (form values) => API values (camelCase, comparable with the loaded data)
 * @param {Function}  [props.validate]  (values) => errors of translated messages (a locked field's are dropped)
 * @param {*}         props.children  the fields
 */
function RuntimeSection({ group, titleId, toForm, toApi, validate, children }) {
	const { data, isPending, error } = useRuntimeSettings(group);

	if (error || isPending) {
		return (
			<div className="card-body">
				<Heading titleId={titleId} />
				{error ? <ErrorAlert error={error} /> : <Loading noLogo />}
			</div>
		);
	}

	return (
		<RuntimeForm group={group} titleId={titleId} data={data} toForm={toForm} toApi={toApi} validate={validate}>
			{children}
		</RuntimeForm>
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
