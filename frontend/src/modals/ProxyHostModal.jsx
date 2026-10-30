import { IconSettings } from "@tabler/icons-react";
import cn from "clsx";
import { useState } from "react";
import { useFormContext, useFormState, useWatch } from "react-hook-form";
import {
	AccessFields,
	ApiErrorContent,
	AppModal,
	Button,
	DirectoryField,
	DomainNamesField,
	ErrorAlert,
	FormSubmit,
	HasPermission,
	HookForm,
	Loading,
	LocationsFields,
	NginxConfigField,
	RequestProgress,
	SSLCertificateField,
	SSLOptionsFields,
	SwitchField,
	useAppForm,
	useRecheckDependent,
	useResetToSaved,
} from "src/components";
import {
	DirtyTracker,
	useAccessLists,
	useDirectorySuggestions,
	useIsAdmin,
	useProxyHost,
	useProxyHosts,
	useSetProxyHost,
	useTlsQueriesSettled,
	useUnsavedChangesGuard,
} from "src/hooks";
import { intl, T } from "src/locale";
import EasyModal from "src/modules/easyModal";
import { joinIds } from "src/modules/FormFields";
import { applyChanges } from "src/modules/HookForm";
import { domainNamesOptions } from "src/modules/HostForms";
import { MANAGE, PROXY_HOSTS } from "src/modules/Permissions";
import {
	hostRecheckOnScheme,
	namedLocations,
	proxyHostDefaults,
	proxyHostPayload,
	proxyHostValidate,
} from "src/modules/ProxyHostForms";
import { getOptionHintId, getOptionsResetByScheme, proxyOptionChanges } from "src/modules/ProxyOptions";
import { validations } from "src/modules/Validations";
import { getNginxConfigError, NginxConfigErrorMsg, showObjectSuccess } from "src/notifications";

// field name -> label for the note next to Save (no control has these names)
const FIELD_LABELS = {
	locations: "column.custom-locations",
	npmproAccessListIds: "proxy-host.global-access-lists",
};

const validate = proxyHostValidate(validations);

// a proxy option switch of the Details tab; a change sets what it turns off or on (ProxyOptions.js)
function OptionSwitch({ name, labelId, hint, disabled, onOption }) {
	const { register } = useFormContext();
	return (
		<SwitchField
			id={name}
			label={<T id={labelId} />}
			hint={hint}
			{...register(name, { onChange: (e) => onOption(name, e.target.checked) })}
			disabled={disabled}
		/>
	);
}

// the hint of an option the forward scheme rules out, or null
const schemeHint = (option, scheme) => {
	const hintId = getOptionHintId(option, scheme);
	return hintId ? (
		<span className="d-block">
			<T id={hintId} />
		</span>
	) : null;
};

// the "*" of the Custom locations tab: a location with a path. Its own watch, so typing in a location row re-renders
// this marker, not the whole window
function LocationsTabMarker() {
	const locations = useWatch({ name: "locations" });
	return namedLocations(locations).length > 0 ? "*" : "";
}

function ProxyHostForm({ data, isClone, isAdmin, savedId, errorMsg, onCloseError, close, suggestions }) {
	const { register, getValues, setValue, clearErrors } = useFormContext();
	const { errors, isSubmitting } = useFormState();
	const [
		certificateId,
		npmproDnsChallenge,
		forwardScheme,
		npmproLocationConfig,
		npmproProxyRequestBuffering,
		npmproAuthRequest,
		advancedConfig,
		npmproPropagationSeconds,
	] = useWatch({
		name: [
			"certificateId",
			"npmproDnsChallenge",
			"forwardScheme",
			"npmproLocationConfig",
			"npmproProxyRequestBuffering",
			"npmproAuthRequest",
			"advancedConfig",
			"npmproPropagationSeconds",
		],
	});
	const recheckHost = useRecheckDependent("forwardHost");
	const [advVisible, setAdvVisible] = useState(false);
	const [schemeResetNotice, setSchemeResetNotice] = useState(false);
	// what a proxy option turns off or on (the option itself is set by register)
	const applyOption = (name, value) => {
		const { [name]: _changed, ...others } = proxyOptionChanges(name, value);
		applyChanges(setValue, others);
	};
	const hostError = errors.forwardHost?.message ?? null;
	const portError = errors.forwardPort?.message ?? null;
	const upstreamError = errors.npmproAuthRequestUpstream?.message ?? null;
	const pathHint = forwardScheme === "path";
	const httpOnly = forwardScheme !== "http" && forwardScheme !== "https";

	return (
		<>
			<AppModal.Header closeButton={!isSubmitting}>
				<AppModal.Title>
					<T
						id={savedId || (data.id && !isClone) ? "object.edit" : "object.add"}
						tData={{ object: "proxy-host" }}
					/>
				</AppModal.Title>
			</AppModal.Header>
			<AppModal.Body>
				<ErrorAlert className="mb-3" onClose={onCloseError}>
					{errorMsg}
				</ErrorAlert>
				<ul className="nav nav-tabs mb-3" data-bs-toggle="tabs">
					<li className="nav-item" role="presentation">
						<a
							href="#tab-details"
							className="nav-link active"
							data-bs-toggle="tab"
							aria-selected="true"
							role="tab"
						>
							<T id="column.details" />
						</a>
					</li>
					<li className="nav-item" role="presentation">
						<a
							href="#tab-locations"
							className="nav-link"
							data-bs-toggle="tab"
							aria-selected="false"
							role="tab"
						>
							{<T id="column.custom-locations" />}
							<LocationsTabMarker />
						</a>
					</li>
					<li className="nav-item" role="presentation">
						<a href="#tab-ssl" className="nav-link" data-bs-toggle="tab" aria-selected="false" role="tab">
							<T id="column.ssl" />
						</a>
					</li>
					<li className="nav-item" role="presentation">
						<a
							href="#tab-advanced"
							className="nav-link"
							data-bs-toggle="tab"
							aria-selected="false"
							role="tab"
						>
							<T id="domains.advanced" />
							{advancedConfig?.trim() ? "*" : ""}
						</a>
					</li>
				</ul>
				<div className="tab-content">
					<div className="tab-pane active show" id="tab-details" role="tabpanel">
						<DomainNamesField {...domainNamesOptions({ certificateId, npmproDnsChallenge })} />
						<div className="row">
							<div className="col-md-3">
								<div className="mb-3">
									<label className="form-label" htmlFor="forwardScheme">
										<T id="host.forward-scheme" />
									</label>
									<select
										id="forwardScheme"
										className="form-select"
										required
										{...register("forwardScheme", {
											onChange: (e) => {
												const scheme = e.target.value;
												setSchemeResetNotice(
													getOptionsResetByScheme(getValues(), scheme).length > 0,
												);
												applyOption("forwardScheme", scheme);
												// forwardScheme is still the scheme before this change
												if (hostRecheckOnScheme(forwardScheme, scheme)) recheckHost();
											},
										})}
									>
										<option value="http">http://</option>
										<option value="https">https://</option>
										<option value="path">
											{intl.formatMessage({
												id: "host.forward-scheme.path",
											})}
										</option>
										<option value="empty">
											{intl.formatMessage({
												id: "host.forward-scheme.empty",
											})}
										</option>
										<option value="grpc">grpc://</option>
										<option value="grpcs">grpcs://</option>
									</select>
									{schemeResetNotice && (
										<small className="form-hint text-warning">
											<T id="host.forward-scheme.options-reset" />
										</small>
									)}
								</div>
							</div>
							<div className="col-md-5">
								<div className="mb-3">
									<label className="form-label" htmlFor="forwardHost">
										<T id="proxy-host.forward-host-path" />
									</label>
									<input
										id="forwardHost"
										type="text"
										className={`form-control ${hostError ? "is-invalid" : ""}`}
										placeholder="example.com"
										required={forwardScheme !== "empty"}
										aria-invalid={hostError ? "true" : undefined}
										aria-describedby={joinIds(
											hostError ? "forwardHost-error" : null,
											pathHint ? "forwardHost-hint" : null,
										)}
										{...register("forwardHost")}
									/>
									{hostError ? (
										<div className="invalid-feedback" id="forwardHost-error">
											{hostError}
										</div>
									) : null}
									{pathHint ? (
										<div className="form-hint" id="forwardHost-hint">
											<T id="host.forward-host.path-hint" />
										</div>
									) : null}
								</div>
							</div>
							<div className="col-md-4">
								<div className="mb-3">
									<label className="form-label" htmlFor="forwardPort">
										<T id="host.forward-port" />
									</label>
									<div className={cn("input-group", { "has-validation": portError })}>
										<input
											id="forwardPort"
											type="text"
											inputMode="numeric"
											className={`form-control ${portError ? "is-invalid" : ""}`}
											placeholder={intl.formatMessage(
												{ id: "form.example" },
												{ example: "8081" },
											)}
											{...register("forwardPort")}
										/>
										{(isAdmin || npmproLocationConfig?.trim()) && (
											<button
												type="button"
												className="btn btn-icon"
												title={intl.formatMessage({
													id: "host.location-config.toggle",
												})}
												aria-label={intl.formatMessage({
													id: "host.location-config.toggle",
												})}
												aria-expanded={advVisible}
												onClick={() => setAdvVisible((prev) => !prev)}
											>
												<IconSettings size={20} aria-hidden="true" />
												{npmproLocationConfig?.trim() ? "*" : ""}
											</button>
										)}

										{portError ? <div className="invalid-feedback">{portError}</div> : null}
									</div>
								</div>
							</div>
						</div>
						<div className="my-3">
							<h4 className="py-2">
								<T id="options" />
							</h4>
							<div className="divide-y">
								<OptionSwitch
									name="npmproNoindex"
									labelId="host.flags.send-noindex"
									onOption={applyOption}
								/>
								<OptionSwitch
									name="npmproCrowdsecAppsec"
									labelId="host.flags.disable-crowdsec-appsec"
									hint={
										npmproProxyRequestBuffering && (
											<span className="d-block">
												<T id="host.flags.hint.appsec-request-buffering" />
											</span>
										)
									}
									onOption={applyOption}
								/>
								<OptionSwitch
									name="npmproProxyRequestBuffering"
									labelId="host.flags.disable-request-buffering"
									hint={
										<>
											<span className="d-block">
												<T id="host.flags.hint.request-buffering-appsec" />
											</span>
											{schemeHint("npmproProxyRequestBuffering", forwardScheme)}
										</>
									}
									disabled={httpOnly}
									onOption={applyOption}
								/>
								<OptionSwitch
									name="npmproProxyResponseBuffering"
									labelId="host.flags.disable-response-buffering"
									hint={schemeHint("npmproProxyResponseBuffering", forwardScheme)}
									disabled={httpOnly}
									onOption={applyOption}
								/>
								<OptionSwitch
									name="npmproUpstreamCompression"
									labelId="host.flags.upstream-compression"
									hint={schemeHint("npmproUpstreamCompression", forwardScheme)}
									disabled={["path", "empty"].includes(forwardScheme)}
									onOption={applyOption}
								/>
								<OptionSwitch
									name="npmproFancyindex"
									labelId="host.flags.fancyindex"
									hint={schemeHint("npmproFancyindex", forwardScheme)}
									disabled={forwardScheme !== "path"}
									onOption={applyOption}
								/>
							</div>
							<div className="mt-3">
								<div className="mb-3">
									<label className="form-label" htmlFor="npmproXFrameOptions">
										X-Frame-Options
									</label>
									<select
										id="npmproXFrameOptions"
										className="form-select"
										required
										{...register("npmproXFrameOptions")}
									>
										<option value="SAMEORIGIN">SAMEORIGIN</option>
										<option value="DENY">DENY</option>
										<option value="none">none</option>
										<option value="upstream">upstream</option>
									</select>
								</div>
								<div className="mb-3">
									<label className="form-label" htmlFor="npmproAuthRequest">
										<T id="host.auth-request" />
									</label>
									<select
										id="npmproAuthRequest"
										className="form-select"
										required
										{...register("npmproAuthRequest", {
											onChange: (e) => {
												applyOption("npmproAuthRequest", e.target.value);
												// the upstream is hidden without an auth request
												if (e.target.value === "none") clearErrors("npmproAuthRequestUpstream");
											},
										})}
									>
										<option value="none">none</option>
										<option value="anubis">anubis</option>
										<option value="tinyauth">tinyauth</option>
										<option value="oauth2proxy">oauth2proxy</option>
										<option value="voidauth">voidauth</option>
										<option value="authelia">authelia (modern)</option>
										<option value="authentik">authentik</option>
										<option value="authentik-send-basic-auth">authentik-send-basic-auth</option>
									</select>
								</div>
								{npmproAuthRequest !== "none" && (
									<div className="mb-3">
										<label className="form-label" htmlFor="npmproAuthRequestUpstream">
											<T id="host.auth-request-upstream" />
										</label>
										<input
											id="npmproAuthRequestUpstream"
											type="text"
											className={`form-control ${upstreamError ? "is-invalid" : ""}`}
											placeholder={intl.formatMessage({
												id: "host.auth-request-upstream.placeholder",
											})}
											maxLength={255}
											{...register("npmproAuthRequestUpstream")}
										/>
										{upstreamError ? <div className="invalid-feedback">{upstreamError}</div> : null}
									</div>
								)}
							</div>
						</div>
						<div className="my-3">
							<h4 className="py-2">
								<T id="proxy-host.global-access-lists" />
							</h4>
							<AccessFields
								name="npmproAccessListIds"
								typeName="npmproAccessListType"
								authRequest={npmproAuthRequest}
							/>
						</div>
						{advVisible && (
							<div className="">
								<label className="form-label" htmlFor="npmproLocationConfig">
									<T id="host.location-config.label" />
								</label>
								<textarea
									id="npmproLocationConfig"
									className="form-control font-monospace"
									spellCheck={false}
									placeholder={intl.formatMessage({
										id: "nginx-config.placeholder",
									})}
									rows={8}
									readOnly={!isAdmin}
									aria-describedby={isAdmin ? undefined : "npmproLocationConfig-hint"}
									{...register("npmproLocationConfig")}
								/>
								{!isAdmin && (
									<div className="form-hint" id="npmproLocationConfig-hint">
										<T id="nginx-config.admin-only" />
									</div>
								)}
							</div>
						)}
					</div>
					<div className="tab-pane" id="tab-locations" role="tabpanel">
						<LocationsFields />
					</div>
					<div className="tab-pane" id="tab-ssl" role="tabpanel">
						<SSLCertificateField label="ssl-certificate" allowNew />

						<SSLOptionsFields forProxyHost />
					</div>
					<div className="tab-pane" id="tab-advanced" role="tabpanel">
						<NginxConfigField />
						<div className="row mt-3">
							<div className="col-md-12 mb-3">
								<DirectoryField
									labelId="proxy-host.directory"
									datalistId="directory-suggestions-proxy"
									suggestions={suggestions}
								/>
							</div>
						</div>
					</div>
				</div>
				<RequestProgress
					running={isSubmitting && certificateId === "new"}
					propagationSeconds={npmproPropagationSeconds}
				/>
			</AppModal.Body>
			<AppModal.Footer>
				<Button className="btn-link link-secondary" onClick={close} disabled={isSubmitting}>
					<T id="cancel" />
				</Button>
				<HasPermission section={PROXY_HOSTS} permission={MANAGE} hideError>
					<FormSubmit
						labels={FIELD_LABELS}
						className="ms-auto"
						edit={Boolean(data.id) && !isClone}
						color="primary"
						isLoading={isSubmitting}
						disabled={isSubmitting}
					>
						<T id="save" />
					</FormSubmit>
				</HasPermission>
			</AppModal.Footer>
		</>
	);
}

// the form, mounted once the host is loaded and the reads of the TLS tab and the access lists have settled
// (useTlsQueriesSettled): complete defaultValues from the first render, no reset on a refetch. A user whose role is
// not known yet (its read failed and retries) starts as a non-admin clone would (no raw nginx config)
function ProxyHostEditor({ id, isClone, isAdmin, data, save, remove, dirtyRef, ...formProps }) {
	const [defaultValues] = useState(() => proxyHostDefaults(data, { isClone, isAdmin }));
	const methods = useAppForm({ defaultValues, validate });
	const resetToSaved = useResetToSaved(methods);
	const [errorMsg, setErrorMsg] = useState(null);
	// set once a new host was created but its nginx config failed, so saving again updates it
	const [savedId, setSavedId] = useState(null);

	const onSubmit = async (values) => {
		setErrorMsg(null);
		try {
			const row = await save({
				id: savedId ?? (id === "new" || isClone ? undefined : id),
				...proxyHostPayload(values),
			});
			const nginxErr = getNginxConfigError(row);
			if (nginxErr === null) {
				showObjectSuccess("proxy-host", "saved");
				remove();
				return;
			}
			setSavedId(row.id);
			// the changes are saved, only the nginx config needs fixing. Keep the certificate the backend created,
			// otherwise saving again with "new" would request another one
			methods.setValue("certificateId", row.certificateId);
			resetToSaved();
			setErrorMsg(<NginxConfigErrorMsg obj="proxy-host" nginxErr={nginxErr} />);
		} catch (err) {
			setErrorMsg(<ApiErrorContent error={err} />);
		}
	};

	return (
		<HookForm methods={methods} onSubmit={onSubmit}>
			<DirtyTracker dirtyRef={dirtyRef} />
			<ProxyHostForm
				data={data}
				isClone={isClone}
				isAdmin={isAdmin}
				savedId={savedId}
				errorMsg={errorMsg}
				onCloseError={() => setErrorMsg(null)}
				{...formProps}
			/>
		</HookForm>
	);
}

const ProxyHostModal = EasyModal.create(({ id, isClone, visible, remove }) => {
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	const { data, error } = useProxyHost(id);
	const isAdmin = useIsAdmin();
	// the key AccessFields reads, so nothing is fetched twice
	const accessLists = useAccessLists(["owner", "items", "clients"]);
	const settled = useTlsQueriesSettled({ accessLists });
	const { mutateAsync: save, isPending: isSaving } = useSetProxyHost();
	const { data: allProxyHosts } = useProxyHosts();
	const suggestions = useDirectorySuggestions(allProxyHosts);
	// never false again once true: a refetch keeps data (also when it fails), settled is latched
	const ready = Boolean(data) && settled;

	return (
		<AppModal show={visible} onHide={isSaving ? undefined : close} backdrop="static" centered={false}>
			{error && <ErrorAlert error={error} className="m-3" />}
			{!(ready || error) && <Loading noLogo />}
			{ready && (
				<ProxyHostEditor
					id={id}
					isClone={isClone}
					isAdmin={isAdmin}
					data={data}
					save={save}
					remove={remove}
					dirtyRef={dirtyRef}
					suggestions={suggestions}
					close={close}
				/>
			)}
		</AppModal>
	);
});

const showProxyHostModal = (id, isClone) => {
	EasyModal.show(ProxyHostModal, { id, isClone });
};

export { showProxyHostModal };
