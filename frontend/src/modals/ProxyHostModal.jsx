import { IconSettings } from "@tabler/icons-react";
import cn from "clsx";
import { Field, Form, Formik } from "formik";
import { useState } from "react";
import {
	AccessFields,
	ApiErrorContent,
	AppModal,
	Button,
	DirectoryField,
	DomainNamesField,
	ErrorAlert,
	HasPermission,
	Loading,
	LocationsFields,
	NginxConfigField,
	RequestProgress,
	SSLCertificateField,
	SSLOptionsFields,
} from "src/components";
import {
	DirtyTracker,
	useDirectorySuggestions,
	useProxyHost,
	useProxyHosts,
	useSetProxyHost,
	useUnsavedChangesGuard,
} from "src/hooks";
import { intl, T } from "src/locale";
import EasyModal from "src/modules/easyModal";
import { MANAGE, PROXY_HOSTS } from "src/modules/Permissions";
import { getOptionHintId, getOptionsResetByScheme } from "src/modules/ProxyOptions";
import { showTabOfInvalid, validateNumber, validateUpstreamUrl } from "src/modules/Validations";
import { getNginxConfigError, NginxConfigErrorMsg, showObjectSuccess } from "src/notifications";

const ProxyHostModal = EasyModal.create(({ id, isClone, visible, remove }) => {
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	const { data, isPending, error } = useProxyHost(id);
	const { data: allProxyHosts } = useProxyHosts();
	const suggestions = useDirectorySuggestions(allProxyHosts);
	const { mutate: setProxyHost } = useSetProxyHost();
	const [errorMsg, setErrorMsg] = useState(null);
	// set once a new host was created but its nginx config failed, so saving again updates it
	const [savedId, setSavedId] = useState(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [advVisible, setAdvVisible] = useState(false);
	const [schemeResetNotice, setSchemeResetNotice] = useState(false);
	const initialLocations = data?.locations.map(({ id: locationId, proxyHostId, accessLists, ...location }) => ({
		...location,
		npmproAccessListIds: accessLists.map((accessList) => accessList.id),
	}));

	const onSubmit = (values, { resetForm, setSubmitting }) => {
		if (isSubmitting) return;
		setIsSubmitting(true);
		setErrorMsg(null);

		// Set the unrestricted acls here (remove any data in their acl lists)
		const globalType = values.npmproAccessListType;
		let globalAclIds = values.npmproAccessListIds;
		if (globalType === "public") {
			globalAclIds = [];
		}

		const payload = {
			id: savedId ?? (id === "new" || isClone ? undefined : id),
			...values,
			npmproAccessListIds: globalAclIds,
			forwardPort: values.forwardPort || 0,
			locations: values.locations.map((location) => ({ ...location, forwardPort: location.forwardPort || 0 })),
		};

		setProxyHost(payload, {
			onError: (err) => {
				setErrorMsg(<ApiErrorContent error={err} />);
			},
			onSuccess: (row) => {
				const nginxErr = getNginxConfigError(row);
				if (nginxErr === null) {
					showObjectSuccess("proxy-host", "saved");
					remove();
					return;
				}
				setSavedId(row.id);
				// the changes are saved, only the nginx config needs fixing. Keep the certificate the backend
				// created, otherwise saving again with "new" would request another one
				resetForm({ values: { ...values, certificateId: row.certificateId } });
				setErrorMsg(<NginxConfigErrorMsg obj="proxy-host" nginxErr={nginxErr} />);
			},
			onSettled: () => {
				setIsSubmitting(false);
				setSubmitting(false);
			},
		});
	};

	return (
		<AppModal show={visible} onHide={isSubmitting ? undefined : close} backdrop="static">
			{error && <ErrorAlert error={error} className="m-3" />}
			{isPending && <Loading noLogo />}
			{data && (
				<Formik
					initialValues={{
						// Details tab
						domainNames: data?.domainNames,
						forwardScheme: data?.forwardScheme,
						forwardHost: data?.forwardHost,
						forwardPort: data?.forwardPort || "",
						npmproAccessListIds: data?.accessLists.map((accessList) => accessList.id),
						npmproAccessListType: data?.npmproAccessListType,
						// Locations tab
						locations: initialLocations,
						// SSL tab
						certificateId: data?.certificateId,
						sslForced: data?.sslForced,
						npmproHttp3Support: data?.npmproHttp3Support,
						hstsEnabled: data?.hstsEnabled,
						hstsSubdomains: data?.hstsSubdomains,
						// Advanced tab
						advancedConfig: data?.advancedConfig,
						npmproLocationConfig: data?.npmproLocationConfig,
						npmproDirectory: data?.npmproDirectory,
						npmproMtlsCertificateId: data?.npmproMtlsCertificateId,
						npmproMtlsVerifyClientOptional: data?.npmproMtlsVerifyClientOptional,
						npmproMtlsBypassAuthRequest: data?.npmproMtlsBypassAuthRequest,
						npmproNoindex: data?.npmproNoindex,
						npmproCrowdsecAppsec: data?.npmproCrowdsecAppsec,
						npmproProxyResponseBuffering: data?.npmproProxyResponseBuffering,
						npmproProxyRequestBuffering: data?.npmproProxyRequestBuffering,
						npmproUpstreamCompression: data?.npmproUpstreamCompression,
						npmproFancyindex: data?.npmproFancyindex,
						npmproXFrameOptions: data?.npmproXFrameOptions,
						npmproAuthRequest: data?.npmproAuthRequest,
						npmproAuthRequestUpstream: data?.npmproAuthRequestUpstream,
					}}
					onSubmit={onSubmit}
				>
					{({ values }) => (
						<Form onInvalid={showTabOfInvalid}>
							<DirtyTracker dirtyRef={dirtyRef} />
							<AppModal.Header closeButton={!isSubmitting}>
								<AppModal.Title>
									<T
										id={savedId || (data?.id && !isClone) ? "object.edit" : "object.add"}
										tData={{ object: "proxy-host" }}
									/>
								</AppModal.Title>
							</AppModal.Header>
							<AppModal.Body className="p-0">
								<ErrorAlert onClose={() => setErrorMsg(null)}>{errorMsg}</ErrorAlert>
								<div className="card m-0 border-0">
									<div className="card-header">
										<ul className="nav nav-tabs card-header-tabs" data-bs-toggle="tabs">
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
													{values?.locations?.length > 0 ? "*" : ""}
												</a>
											</li>
											<li className="nav-item" role="presentation">
												<a
													href="#tab-ssl"
													className="nav-link"
													data-bs-toggle="tab"
													aria-selected="false"
													role="tab"
												>
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
													{values?.advancedConfig?.trim() ? "*" : ""}
												</a>
											</li>
										</ul>
									</div>
									<div className="card-body">
										<div className="tab-content">
											<div className="tab-pane active show" id="tab-details" role="tabpanel">
												<DomainNamesField
													isWildcardPermitted={
														values.certificateId !== "new" || values.npmproDnsChallenge
													}
													dnsProviderWildcardSupported
													forCertificate={values.certificateId === "new"}
												/>
												<div className="row">
													<div className="col-md-3">
														<Field name="forwardScheme">
															{({ field, form }) => (
																<div className="mb-3">
																	<label
																		className="form-label"
																		htmlFor="forwardScheme"
																	>
																		<T id="host.forward-scheme" />
																	</label>
																	<select
																		id="forwardScheme"
																		className="form-select"
																		required
																		{...field}
																		onChange={(e) => {
																			const scheme = e.target.value;
																			setSchemeResetNotice(
																				getOptionsResetByScheme(
																					form.values,
																					scheme,
																				).length > 0,
																			);
																			field.onChange(e);
																			if (scheme === "empty") return;
																			if (!["http", "https"].includes(scheme)) {
																				form.setFieldValue(
																					"npmproProxyRequestBuffering",
																					false,
																				);
																				form.setFieldValue(
																					"npmproProxyResponseBuffering",
																					false,
																				);
																			}
																			if (scheme === "path") {
																				form.setFieldValue(
																					"npmproUpstreamCompression",
																					false,
																				);
																			} else {
																				form.setFieldValue(
																					"npmproFancyindex",
																					false,
																				);
																			}
																		}}
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
															)}
														</Field>
													</div>
													<div className="col-md-5">
														<Field name="forwardHost">
															{({ field, form }) => (
																<div className="mb-3">
																	<label className="form-label" htmlFor="forwardHost">
																		<T id="proxy-host.forward-host-path" />
																	</label>
																	<input
																		id="forwardHost"
																		type="text"
																		className="form-control"
																		placeholder="example.com"
																		required={form.values.forwardScheme !== "empty"}
																		pattern="(?=\S{0,255}$)[^\s\/]{0,253}(\/\S*)?"
																		{...field}
																	/>
																</div>
															)}
														</Field>
													</div>
													<div className="col-md-4">
														<Field name="forwardPort" validate={validateNumber(-1, 65535)}>
															{({ field, form }) => (
																<div className="mb-3">
																	<label className="form-label" htmlFor="forwardPort">
																		<T id="host.forward-port" />
																	</label>
																	<div className="input-group has-validation">
																		<input
																			id="forwardPort"
																			type="text"
																			inputMode="numeric"
																			pattern="[1-9][0-9]*"
																			className={`form-control ${form.errors.forwardPort && form.touched.forwardPort ? "is-invalid" : ""}`}
																			placeholder={intl.formatMessage(
																				{ id: "form.example" },
																				{ example: "8081" },
																			)}
																			{...field}
																		/>
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
																			onClick={() =>
																				setAdvVisible((prev) => !prev)
																			}
																		>
																			<IconSettings
																				size={20}
																				aria-hidden="true"
																			/>
																			{values?.npmproLocationConfig?.trim()
																				? "*"
																				: ""}
																		</button>

																		{form.errors.forwardPort ? (
																			<div className="invalid-feedback">
																				{form.touched.forwardPort
																					? form.errors.forwardPort
																					: null}
																			</div>
																		) : null}
																	</div>
																</div>
															)}
														</Field>
													</div>
												</div>
												<div className="my-3">
													<h4 className="py-2">
														<T id="options" />
													</h4>
													<div className="divide-y">
														<div>
															<label
																className="row cursor-pointer"
																htmlFor="npmproNoindex"
															>
																<span className="col">
																	<T id="host.flags.send-noindex" />
																</span>
																<span className="col-auto">
																	<Field name="npmproNoindex" type="checkbox">
																		{({ field }) => (
																			<span className="form-check form-check-single form-switch">
																				<input
																					{...field}
																					id="npmproNoindex"
																					className={cn("form-check-input", {
																						"bg-lime": field.checked,
																					})}
																					type="checkbox"
																				/>
																			</span>
																		)}
																	</Field>
																</span>
															</label>
														</div>
														<div>
															<label
																className="row cursor-pointer"
																htmlFor="npmproCrowdsecAppsec"
															>
																<span className="col">
																	<T id="host.flags.disable-crowdsec-appsec" />
																	{values.npmproProxyRequestBuffering && (
																		<small className="form-hint">
																			<T id="host.flags.hint.appsec-request-buffering" />
																		</small>
																	)}
																</span>
																<span className="col-auto">
																	<Field name="npmproCrowdsecAppsec" type="checkbox">
																		{({ field, form }) => (
																			<span className="form-check form-check-single form-switch">
																				<input
																					{...field}
																					id="npmproCrowdsecAppsec"
																					className={cn("form-check-input", {
																						"bg-lime": field.checked,
																					})}
																					type="checkbox"
																					onChange={(e) => {
																						field.onChange(e);
																						if (!e.target.checked) {
																							form.setFieldValue(
																								"npmproProxyRequestBuffering",
																								false,
																							);
																						}
																					}}
																				/>
																			</span>
																		)}
																	</Field>
																</span>
															</label>
														</div>
														<div>
															<label
																className="row cursor-pointer"
																htmlFor="npmproProxyRequestBuffering"
															>
																<span className="col">
																	<T id="host.flags.disable-request-buffering" />
																	<small className="form-hint">
																		<T id="host.flags.hint.request-buffering-appsec" />
																	</small>
																	{getOptionHintId(
																		"npmproProxyRequestBuffering",
																		values.forwardScheme,
																	) && (
																		<small className="form-hint">
																			<T
																				id={getOptionHintId(
																					"npmproProxyRequestBuffering",
																					values.forwardScheme,
																				)}
																			/>
																		</small>
																	)}
																</span>
																<span className="col-auto">
																	<Field
																		name="npmproProxyRequestBuffering"
																		type="checkbox"
																	>
																		{({ field, form }) => (
																			<span className="form-check form-check-single form-switch">
																				<input
																					{...field}
																					id="npmproProxyRequestBuffering"
																					className={cn("form-check-input", {
																						"bg-lime": field.checked,
																					})}
																					type="checkbox"
																					onChange={(e) => {
																						field.onChange(e);
																						if (e.target.checked) {
																							form.setFieldValue(
																								"npmproCrowdsecAppsec",
																								true,
																							);
																						}
																					}}
																					disabled={
																						form.values.forwardScheme !==
																							"http" &&
																						form.values.forwardScheme !==
																							"https"
																					}
																				/>
																			</span>
																		)}
																	</Field>
																</span>
															</label>
														</div>
														<div>
															<label
																className="row cursor-pointer"
																htmlFor="npmproProxyResponseBuffering"
															>
																<span className="col">
																	<T id="host.flags.disable-response-buffering" />
																	{getOptionHintId(
																		"npmproProxyResponseBuffering",
																		values.forwardScheme,
																	) && (
																		<small className="form-hint">
																			<T
																				id={getOptionHintId(
																					"npmproProxyResponseBuffering",
																					values.forwardScheme,
																				)}
																			/>
																		</small>
																	)}
																</span>
																<span className="col-auto">
																	<Field
																		name="npmproProxyResponseBuffering"
																		type="checkbox"
																	>
																		{({ field, form }) => (
																			<span className="form-check form-check-single form-switch">
																				<input
																					{...field}
																					id="npmproProxyResponseBuffering"
																					className={cn("form-check-input", {
																						"bg-lime": field.checked,
																					})}
																					type="checkbox"
																					disabled={
																						form.values.forwardScheme !==
																							"http" &&
																						form.values.forwardScheme !==
																							"https"
																					}
																				/>
																			</span>
																		)}
																	</Field>
																</span>
															</label>
														</div>
														<div>
															<label
																className="row cursor-pointer"
																htmlFor="npmproUpstreamCompression"
															>
																<span className="col">
																	<T id="host.flags.upstream-compression" />
																	{getOptionHintId(
																		"npmproUpstreamCompression",
																		values.forwardScheme,
																	) && (
																		<small className="form-hint">
																			<T
																				id={getOptionHintId(
																					"npmproUpstreamCompression",
																					values.forwardScheme,
																				)}
																			/>
																		</small>
																	)}
																</span>
																<span className="col-auto">
																	<Field
																		name="npmproUpstreamCompression"
																		type="checkbox"
																	>
																		{({ field, form }) => (
																			<span className="form-check form-check-single form-switch">
																				<input
																					{...field}
																					id="npmproUpstreamCompression"
																					className={cn("form-check-input", {
																						"bg-lime": field.checked,
																					})}
																					type="checkbox"
																					disabled={[
																						"path",
																						"empty",
																					].includes(
																						form.values.forwardScheme,
																					)}
																				/>
																			</span>
																		)}
																	</Field>
																</span>
															</label>
														</div>
														<div>
															<label
																className="row cursor-pointer"
																htmlFor="npmproFancyindex"
															>
																<span className="col">
																	<T id="host.flags.fancyindex" />
																	{getOptionHintId(
																		"npmproFancyindex",
																		values.forwardScheme,
																	) && (
																		<small className="form-hint">
																			<T
																				id={getOptionHintId(
																					"npmproFancyindex",
																					values.forwardScheme,
																				)}
																			/>
																		</small>
																	)}
																</span>
																<span className="col-auto">
																	<Field name="npmproFancyindex" type="checkbox">
																		{({ field, form }) => (
																			<span className="form-check form-check-single form-switch">
																				<input
																					{...field}
																					id="npmproFancyindex"
																					className={cn("form-check-input", {
																						"bg-lime": field.checked,
																					})}
																					type="checkbox"
																					disabled={
																						form.values.forwardScheme !==
																						"path"
																					}
																				/>
																			</span>
																		)}
																	</Field>
																</span>
															</label>
														</div>
														<div>
															<label
																className="row cursor-pointer"
																htmlFor="npmproXFrameOptions"
															>
																<span className="col">X-Frame-Options</span>
																<span className="col-auto">
																	<Field name="npmproXFrameOptions">
																		{({ field }) => (
																			<select
																				id="npmproXFrameOptions"
																				className="form-select"
																				required
																				{...field}
																			>
																				<option value="SAMEORIGIN">
																					SAMEORIGIN
																				</option>
																				<option value="DENY">DENY</option>
																				<option value="none">none</option>
																				<option value="upstream">
																					upstream
																				</option>
																			</select>
																		)}
																	</Field>
																</span>
															</label>
														</div>
														<div>
															<label
																className="row cursor-pointer"
																htmlFor="npmproAuthRequest"
															>
																<span className="col">
																	<T id="host.auth-request" />
																</span>
																<span className="col-auto">
																	<Field name="npmproAuthRequest">
																		{({ field, form }) => (
																			<select
																				id="npmproAuthRequest"
																				className="form-select"
																				required
																				{...field}
																				onChange={(e) => {
																					field.onChange(e);
																					if (e.target.value === "none") {
																						form.setFieldValue(
																							"npmproAuthRequestUpstream",
																							"",
																						);
																					}
																				}}
																			>
																				<option value="none">none</option>
																				<option value="anubis">anubis</option>
																				<option value="tinyauth">
																					tinyauth
																				</option>
																				<option value="oauth2proxy">
																					oauth2proxy
																				</option>
																				<option value="voidauth">
																					voidauth
																				</option>
																				<option value="authelia">
																					authelia (modern)
																				</option>
																				<option value="authentik">
																					authentik
																				</option>
																				<option value="authentik-send-basic-auth">
																					authentik-send-basic-auth
																				</option>
																			</select>
																		)}
																	</Field>
																</span>
															</label>
														</div>
														{values.npmproAuthRequest !== "none" && (
															<div>
																<label
																	className="row cursor-pointer"
																	htmlFor="npmproAuthRequestUpstream"
																>
																	<span className="col">
																		<T id="host.auth-request-upstream" />
																	</span>
																	<span className="col-auto">
																		<Field
																			name="npmproAuthRequestUpstream"
																			validate={validateUpstreamUrl()}
																		>
																			{({ field, form }) => (
																				<>
																					<input
																						id="npmproAuthRequestUpstream"
																						type="text"
																						className={`form-control ${form.errors.npmproAuthRequestUpstream && form.touched.npmproAuthRequestUpstream ? "is-invalid" : ""}`}
																						placeholder={intl.formatMessage(
																							{
																								id: "host.auth-request-upstream.placeholder",
																							},
																						)}
																						maxLength={255}
																						pattern="^https?://(([^\s\/:]+|\[[a-fA-F0-9:]+\]):[0-9]+|cu_[^\s\/:]+)$"
																						{...field}
																					/>

																					{form.errors
																						.npmproAuthRequestUpstream ? (
																						<div className="invalid-feedback">
																							{form.touched
																								.npmproAuthRequestUpstream
																								? form.errors
																										.npmproAuthRequestUpstream
																								: null}
																						</div>
																					) : null}
																				</>
																			)}
																		</Field>
																	</span>
																</label>
															</div>
														)}
													</div>
												</div>
												<div className="my-3">
													<h4 className="py-2">
														<T id="proxy-host.global-access-lists" />
													</h4>
													<AccessFields
														initialAccessListType={data?.npmproAccessListType}
														initialAccessListIds={data?.accessLists.map(
															(accessList) => accessList.id,
														)}
														name="npmproAccessListIds"
														typeFieldName="npmproAccessListType"
														authRequest={values.npmproAuthRequest}
													/>
												</div>
												<Field name="npmproLocationConfig">
													{({ field }) => (
														<>
															{advVisible && (
																<div className="">
																	<label
																		className="form-label"
																		htmlFor="npmproLocationConfig"
																	>
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
																		{...field}
																	/>
																</div>
															)}
														</>
													)}
												</Field>
											</div>
											<div className="tab-pane" id="tab-locations" role="tabpanel">
												<LocationsFields initialValues={initialLocations} />
											</div>
											<div className="tab-pane" id="tab-ssl" role="tabpanel">
												<SSLCertificateField
													name="certificateId"
													label="ssl-certificate"
													allowNew
												/>

												<SSLOptionsFields color="bg-lime" forProxyHost />
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
									</div>
								</div>
							</AppModal.Body>
							<RequestProgress
								running={isSubmitting && values.certificateId === "new"}
								propagationSeconds={values.npmproPropagationSeconds}
							/>
							<AppModal.Footer>
								<Button className="btn-link link-secondary" onClick={close} disabled={isSubmitting}>
									<T id="cancel" />
								</Button>
								<HasPermission section={PROXY_HOSTS} permission={MANAGE} hideError>
									<Button
										type="submit"
										color="primary"
										className="ms-auto"
										isLoading={isSubmitting}
										disabled={isSubmitting}
									>
										<T id="save" />
									</Button>
								</HasPermission>
							</AppModal.Footer>
						</Form>
					)}
				</Formik>
			)}
		</AppModal>
	);
});

const showProxyHostModal = (id, isClone) => {
	EasyModal.show(ProxyHostModal, { id, isClone });
};

export { showProxyHostModal };
