import {
	IconChevronDown,
	IconChevronRight,
	IconPlus,
	IconSearch,
	IconSettings,
	IconTrash,
	IconX,
} from "@tabler/icons-react";
import cn from "clsx";
import { getIn, useField, useFormikContext } from "formik";
import { useRef, useState } from "react";
import { AccessFields, SwitchField } from "src/components";
import { useIsAdmin } from "src/hooks";
import { intl, T } from "src/locale";
import { visibleErrorAt } from "src/modules/FormFields";
import { forwardSummary } from "src/modules/Forward";
import { getOptionHintId } from "src/modules/ProxyOptions";
import { upstreamUrlPattern } from "src/modules/Validations";
import { NoticeAlert } from "../NoticeAlert";

// the backend's rules (schema/components/proxy-host-object.json, lib/host-config-guard.js)
const PATH = /^\S{1,255}$/u;
const FORWARD_HOST = /^[^\s/;{}"'\\#]{0,253}(?:\/[^\s;{}"'\\#]*)?$/u;
const PORT = /^\d{1,5}$/u;

const message = (id, data) => intl.formatMessage({ id }, data);

/**
 * The errors of the location rows (blank ones included), one object per row in the same order, or undefined
 *
 * @param   {Object[]} rows
 * @returns {Object[]|undefined}
 */
const locationErrors = (rows) => {
	const seen = new Set();
	const errors = rows.map((row) => {
		const error = {};
		const path = String(row.path ?? "").trim();
		if (path === "") error.path = message("error.required");
		else if (!PATH.test(path)) error.path = message("location.path.invalid");
		else {
			const key = `${row.locationType}${path}`;
			if (seen.has(key)) error.path = message("location.path.duplicate");
			seen.add(key);
		}
		const host = String(row.forwardHost ?? "").trim();
		if (row.forwardScheme !== "empty") {
			if (host === "") error.forwardHost = message("error.required");
			else if (host.length > 255 || !FORWARD_HOST.test(host)) error.forwardHost = message("error.invalid-host");
		}
		const port = String(row.forwardPort ?? "").trim();
		if (port !== "" && port !== "0" && !(PORT.test(port) && Number(port) >= 1 && Number(port) <= 65535)) {
			error.forwardPort = message("error.number-range", { min: 1, max: 65535 });
		}
		if (
			row.npmproAuthRequest !== "none" &&
			row.npmproAuthRequestUpstream &&
			!upstreamUrlPattern.test(row.npmproAuthRequestUpstream)
		) {
			error.npmproAuthRequestUpstream = message("error.invalid-upstream-url");
		}
		if (row.npmproAccessListType === "custom" && !(row.npmproAccessListIds?.length > 0)) {
			error.npmproAccessListIds = message("error.required");
		}
		return Object.keys(error).length > 0 ? error : undefined;
	});
	return errors.some(Boolean) ? errors : undefined;
};

export function LocationsFields({ initialValues, name = "locations" }) {
	const nextUiKey = useRef(0);
	const isAdmin = useIsAdmin();
	const createUiLocation = (item) => ({
		npmproEnabled: true,
		path: "",
		locationType: "",
		advancedConfig: "",
		forwardScheme: "http",
		forwardHost: "",
		forwardPort: "",
		npmproAccessListIds: [],
		npmproNoindex: false,
		npmproCrowdsecAppsec: false,
		npmproProxyResponseBuffering: false,
		npmproProxyRequestBuffering: false,
		npmproUpstreamCompression: false,
		npmproFancyindex: false,
		npmproXFrameOptions: "SAMEORIGIN",
		npmproAuthRequest: "none",
		npmproAuthRequestUpstream: "",
		npmproAccessListType: "global",
		...item,
		uiKey: nextUiKey.current++,
	});

	const [values, setValues] = useState(initialValues.map(createUiLocation));
	const { setFieldValue, setFieldTouched, errors, touched, submitCount } = useFormikContext();
	// the Formik value leaves out rows without a path, so the rows are checked here (all of them, in UI order)
	const rowsRef = useRef(values);
	useField({ name, validate: () => locationErrors(rowsRef.current) });
	const shownError = (idx, field) => visibleErrorAt({ errors, touched, submitCount }, `${name}[${idx}].${field}`);
	// after a refused save a row with an error is open and not filtered away, so its error can be seen
	const forcedOpen = (idx) => submitCount > 0 && Boolean(getIn(errors, `${name}[${idx}]`));
	const [advVisible, setAdvVisible] = useState([]);
	const [expanded, setExpanded] = useState([]);
	const [filter, setFilter] = useState("");
	const scrollToKey = useRef(null);

	const toggle = (key, list, set) => set(list.includes(key) ? list.filter((i) => i !== key) : [...list, key]);

	const handleAdd = () => {
		const item = createUiLocation();
		const newValues = [...values, item];
		setValues(newValues);
		// checks the new (empty) row too
		setFormField(newValues);
		setExpanded([...expanded, item.uiKey]);
		setFilter("");
		scrollToKey.current = item.uiKey;
	};

	const handleRemove = (idx) => {
		const newValues = values.filter((_, i) => i !== idx);
		setValues(newValues);
		// the touched flags are per row index, which shifts
		void setFieldTouched(name, undefined, false);
		setFormField(newValues);
	};

	const handleChange = (idx, field, fieldValue) => {
		const newValues = values.map((v, i) => {
			if (i !== idx) return v;

			const updatedLocation = { ...v, [field]: fieldValue };

			if (field === "npmproCrowdsecAppsec" && fieldValue === false) {
				updatedLocation.npmproProxyRequestBuffering = false;
			}
			if (field === "npmproProxyRequestBuffering" && fieldValue === true) {
				updatedLocation.npmproCrowdsecAppsec = true;
			}
			if (field === "npmproAuthRequest" && fieldValue === "none") {
				updatedLocation.npmproAuthRequestUpstream = "";
			}
			if (field === "forwardScheme" && fieldValue !== "empty") {
				if (!["http", "https"].includes(fieldValue)) {
					updatedLocation.npmproProxyRequestBuffering = false;
					updatedLocation.npmproProxyResponseBuffering = false;
				}
				if (fieldValue === "path") {
					updatedLocation.npmproUpstreamCompression = false;
				} else {
					updatedLocation.npmproFancyindex = false;
				}
			}
			return updatedLocation;
		});
		setValues(newValues);
		void setFieldTouched(`${name}[${idx}].${field}`, true, false);
		setFormField(newValues);
	};

	const handleAccessFieldsChange = (idx, changes) => {
		const newValues = values.map((val, i) => {
			if (i !== idx) {
				return val;
			}
			return { ...val, ...changes };
		});
		setValues(newValues);
		setFormField(newValues);
	};

	const setFormField = (newValues) => {
		rowsRef.current = newValues;
		const filtered = newValues.filter((v) => v?.path?.trim() !== "").map(({ uiKey, ...rest }) => rest);
		void setFieldValue(name, filtered);
	};

	const isOpen = (item, idx) => expanded.includes(item.uiKey) || forcedOpen(idx);

	const locationLabel = (item) => `${item.locationType}${item.path}`;

	const matchesFilter = (item) =>
		`${locationLabel(item)} ${forwardSummary(item)}`.toLowerCase().includes(filter.trim().toLowerCase());

	if (values.length === 0) {
		return (
			<div className="text-center">
				<button type="button" className="btn my-3" onClick={handleAdd}>
					<T id="action.add-location" />
				</button>
			</div>
		);
	}

	return (
		<>
			<div className="row g-2 mb-3">
				<div className="col">
					<div className="input-group">
						<span className="input-group-text">
							<IconSearch size={16} />
						</span>
						<input
							type="text"
							className="form-control"
							autoComplete="off"
							placeholder={intl.formatMessage({ id: "location.filter" })}
							aria-label={intl.formatMessage({ id: "location.filter" })}
							value={filter}
							onChange={(e) => setFilter(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
						/>

						<button
							type="button"
							className="btn btn-icon"
							title={intl.formatMessage({ id: "action.clear" })}
							aria-label={intl.formatMessage({ id: "action.clear" })}
							onClick={() => setFilter("")}
						>
							<IconX size={16} />
						</button>
					</div>
				</div>
				<div className="col-auto">
					<button type="button" className="btn" onClick={handleAdd}>
						<IconPlus size={16} className="me-1" />
						<T id="action.add-location" />
					</button>
				</div>
			</div>
			{!values.some(matchesFilter) && (
				<div className="text-secondary text-center my-3">
					<T id="empty-search" />
				</div>
			)}
			{values.map((item, idx) => (
				<div
					key={item.uiKey}
					ref={(node) => {
						if (node && scrollToKey.current === item.uiKey) {
							scrollToKey.current = null;
							node.scrollIntoView({ block: "nearest" });
						}
					}}
					className={cn("card", "card-active", "mb-2", !matchesFilter(item) && !forcedOpen(idx) && "d-none")}
					style={{ "--tblr-card-border-color": "var(--tblr-border-color)" }}
				>
					<div className={cn("card-header", "p-2", !isOpen(item, idx) && "border-bottom-0")}>
						<button
							type="button"
							className="d-flex flex-fill align-self-stretch align-items-center overflow-hidden p-0 text-start text-body bg-transparent border-0"
							aria-expanded={isOpen(item, idx)}
							aria-controls={`location-body-${item.uiKey}`}
							onClick={() => toggle(item.uiKey, expanded, setExpanded)}
						>
							{isOpen(item, idx) ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
							<span className="ms-2 fw-medium text-truncate">{locationLabel(item)}</span>
							<span className="ms-2 text-secondary text-truncate">{forwardSummary(item)}</span>
							{item.advancedConfig?.trim() && (
								<span
									className="ms-2 text-secondary d-flex align-items-center flex-shrink-0"
									role="img"
									title={intl.formatMessage({ id: "nginx-config.label" })}
									aria-label={intl.formatMessage({ id: "nginx-config.label" })}
								>
									<IconSettings size={16} />
								</span>
							)}
						</button>
						<button
							type="button"
							className="btn btn-action ms-2"
							title={intl.formatMessage({ id: "action.delete" })}
							aria-label={intl.formatMessage({ id: "action.delete" })}
							onClick={() => handleRemove(idx)}
						>
							<IconTrash size={16} className="icon" />
						</button>
					</div>
					<div className={cn("card-body", !isOpen(item, idx) && "d-none")} id={`location-body-${item.uiKey}`}>
						<div className="row mb-3">
							<SwitchField
								id={`npmproEnabled-${item.uiKey}`}
								label={<T id="enabled" />}
								checked={item.npmproEnabled}
								onChange={(e) => handleChange(idx, "npmproEnabled", e.target.checked)}
							/>
						</div>
						<div className="row">
							<div className="col-md-10">
								<div className="input-group mb-3">
									<span className="input-group-text">
										<T id="location" />
									</span>
									<select
										id={`locationType-${item.uiKey}`}
										className="form-select w-auto flex-grow-0"
										value={item.locationType}
										onChange={(e) => handleChange(idx, "locationType", e.target.value)}
									>
										<option value="" />
										<option value="@">@</option>
										<option value="= ">=</option>
										<option value="~ ">~</option>
										<option value="~* ">~*</option>
										<option value="^~ ">^~</option>
									</select>
									<input
										type="text"
										name={`${name}[${idx}].path`}
										className={cn("form-control", shownError(idx, "path") && "is-invalid")}
										placeholder="/path"
										autoComplete="off"
										required
										aria-label={intl.formatMessage({ id: "location.path" })}
										aria-invalid={shownError(idx, "path") ? "true" : undefined}
										value={item.path}
										onChange={(e) => handleChange(idx, "path", e.target.value)}
									/>
									{shownError(idx, "path") ? (
										<div className="invalid-feedback">{shownError(idx, "path")}</div>
									) : null}
								</div>
							</div>
							<div className="col-md-2 text-end">
								{(isAdmin || item?.advancedConfig?.trim()) && (
									<button
										type="button"
										className="btn p-0"
										title={intl.formatMessage({ id: "location.config.toggle" })}
										aria-label={intl.formatMessage({ id: "location.config.toggle" })}
										aria-expanded={advVisible.includes(item.uiKey)}
										onClick={() => toggle(item.uiKey, advVisible, setAdvVisible)}
									>
										<IconSettings size={20} />
										{item?.advancedConfig?.trim() ? "*" : ""}
									</button>
								)}
							</div>
						</div>
						{!item.path?.endsWith("/") && (item.locationType === "" || item.locationType === "^~ ") && (
							<NoticeAlert role="status">
								<T id="proxy-host.location-no-trailing-slash-warning" />
							</NoticeAlert>
						)}
						<div className="row">
							<div className="col-md-3">
								<div className="mb-3">
									<label className="form-label" htmlFor={`forwardScheme-${item.uiKey}`}>
										<T id="host.forward-scheme" />
									</label>
									<select
										id={`forwardScheme-${item.uiKey}`}
										className="form-control"
										value={item.forwardScheme}
										onChange={(e) => handleChange(idx, "forwardScheme", e.target.value)}
									>
										<option value="http">http://</option>
										<option value="https">https://</option>
										<option value="path">
											{intl.formatMessage({ id: "host.forward-scheme.path" })}
										</option>
										<option value="empty">
											{intl.formatMessage({ id: "host.forward-scheme.empty" })}
										</option>
										<option value="grpc">grpc://</option>
										<option value="grpcs">grpcs://</option>
									</select>
								</div>
							</div>
							<div className="col-md-6">
								<div className="mb-3">
									<label className="form-label" htmlFor={`forwardHost-${item.uiKey}`}>
										<T id="proxy-host.forward-host-path" />
									</label>
									<input
										id={`forwardHost-${item.uiKey}`}
										name={`${name}[${idx}].forwardHost`}
										type="text"
										className={cn("form-control", shownError(idx, "forwardHost") && "is-invalid")}
										required={item.forwardScheme !== "empty"}
										aria-invalid={shownError(idx, "forwardHost") ? "true" : undefined}
										placeholder={intl.formatMessage(
											{ id: "form.example" },
											{ example: "10.0.0.1/path/" },
										)}
										value={item.forwardHost}
										onChange={(e) => handleChange(idx, "forwardHost", e.target.value)}
									/>
									{shownError(idx, "forwardHost") ? (
										<div className="invalid-feedback">{shownError(idx, "forwardHost")}</div>
									) : null}
									{item.forwardScheme === "path" && (
										<div className="form-hint">
											<T id="host.forward-host.path-hint" />
										</div>
									)}
								</div>
							</div>
							<div className="col-md-3">
								<div className="mb-3">
									<label className="form-label" htmlFor={`forwardPort-${item.uiKey}`}>
										<T id="host.forward-port" />
									</label>
									<input
										id={`forwardPort-${item.uiKey}`}
										name={`${name}[${idx}].forwardPort`}
										type="number"
										min={1}
										max={65535}
										className={cn("form-control", shownError(idx, "forwardPort") && "is-invalid")}
										aria-invalid={shownError(idx, "forwardPort") ? "true" : undefined}
										placeholder={intl.formatMessage({ id: "form.example" }, { example: "8081" })}
										value={item.forwardPort || ""}
										onChange={(e) => handleChange(idx, "forwardPort", e.target.value)}
									/>
									{shownError(idx, "forwardPort") ? (
										<div className="invalid-feedback">{shownError(idx, "forwardPort")}</div>
									) : null}
								</div>
							</div>

							<div className="my-3">
								<h4 className="py-2">
									<T id="options" />
								</h4>
								<div className="divide-y">
									<SwitchField
										id={`npmproNoindex-${item.uiKey}`}
										label={<T id="host.flags.send-noindex" />}
										checked={item.npmproNoindex}
										onChange={(e) => handleChange(idx, "npmproNoindex", e.target.checked)}
									/>
									<SwitchField
										id={`npmproCrowdsecAppsec-${item.uiKey}`}
										label={<T id="host.flags.disable-crowdsec-appsec" />}
										hint={
											item.npmproProxyRequestBuffering && (
												<span className="d-block">
													<T id="host.flags.hint.appsec-request-buffering" />
												</span>
											)
										}
										checked={item.npmproCrowdsecAppsec}
										onChange={(e) => handleChange(idx, "npmproCrowdsecAppsec", e.target.checked)}
									/>
									<SwitchField
										id={`npmproProxyRequestBuffering-${item.uiKey}`}
										label={<T id="host.flags.disable-request-buffering" />}
										hint={
											<>
												<span className="d-block">
													<T id="host.flags.hint.request-buffering-appsec" />
												</span>
												{getOptionHintId("npmproProxyRequestBuffering", item.forwardScheme) && (
													<span className="d-block">
														<T
															id={getOptionHintId(
																"npmproProxyRequestBuffering",
																item.forwardScheme,
															)}
														/>
													</span>
												)}
											</>
										}
										checked={item.npmproProxyRequestBuffering}
										onChange={(e) =>
											handleChange(idx, "npmproProxyRequestBuffering", e.target.checked)
										}
										disabled={!["http", "https"].includes(item.forwardScheme)}
									/>
									<SwitchField
										id={`npmproProxyResponseBuffering-${item.uiKey}`}
										label={<T id="host.flags.disable-response-buffering" />}
										hint={
											getOptionHintId("npmproProxyResponseBuffering", item.forwardScheme) && (
												<span className="d-block">
													<T
														id={getOptionHintId(
															"npmproProxyResponseBuffering",
															item.forwardScheme,
														)}
													/>
												</span>
											)
										}
										checked={item.npmproProxyResponseBuffering}
										onChange={(e) =>
											handleChange(idx, "npmproProxyResponseBuffering", e.target.checked)
										}
										disabled={!["http", "https"].includes(item.forwardScheme)}
									/>
									<SwitchField
										id={`npmproUpstreamCompression-${item.uiKey}`}
										label={<T id="host.flags.upstream-compression" />}
										hint={
											getOptionHintId("npmproUpstreamCompression", item.forwardScheme) && (
												<span className="d-block">
													<T
														id={getOptionHintId(
															"npmproUpstreamCompression",
															item.forwardScheme,
														)}
													/>
												</span>
											)
										}
										checked={item.npmproUpstreamCompression}
										onChange={(e) =>
											handleChange(idx, "npmproUpstreamCompression", e.target.checked)
										}
										disabled={["path", "empty"].includes(item.forwardScheme)}
									/>
									<SwitchField
										id={`npmproFancyindex-${item.uiKey}`}
										label={<T id="host.flags.fancyindex" />}
										hint={
											getOptionHintId("npmproFancyindex", item.forwardScheme) && (
												<span className="d-block">
													<T id={getOptionHintId("npmproFancyindex", item.forwardScheme)} />
												</span>
											)
										}
										checked={item.npmproFancyindex}
										onChange={(e) => handleChange(idx, "npmproFancyindex", e.target.checked)}
										disabled={item.forwardScheme !== "path"}
									/>
								</div>
								<div className="mt-3">
									<div className="mb-3">
										<label className="form-label" htmlFor={`npmproXFrameOptions-${item.uiKey}`}>
											X-Frame-Options
										</label>
										<select
											id={`npmproXFrameOptions-${item.uiKey}`}
											className="form-select"
											value={item.npmproXFrameOptions}
											onChange={(e) => handleChange(idx, "npmproXFrameOptions", e.target.value)}
										>
											<option value="SAMEORIGIN">SAMEORIGIN</option>
											<option value="DENY">DENY</option>
											<option value="none">none</option>
											<option value="upstream">upstream</option>
										</select>
									</div>
									<div className="mb-3">
										<label className="form-label" htmlFor={`npmproAuthRequest-${item.uiKey}`}>
											<T id="host.auth-request" />
										</label>
										<select
											id={`npmproAuthRequest-${item.uiKey}`}
											className="form-select"
											value={item.npmproAuthRequest}
											onChange={(e) => handleChange(idx, "npmproAuthRequest", e.target.value)}
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
									{item?.npmproAuthRequest?.length > 0 && item.npmproAuthRequest !== "none" && (
										<div className="mb-3">
											<label
												className="form-label"
												htmlFor={`npmproAuthRequestUpstream-${item.uiKey}`}
											>
												<T id="host.auth-request-upstream" />
											</label>
											<input
												id={`npmproAuthRequestUpstream-${item.uiKey}`}
												type="text"
												className={`form-control ${item.npmproAuthRequestUpstream && !upstreamUrlPattern.test(item.npmproAuthRequestUpstream) ? "is-invalid" : ""}`}
												placeholder={intl.formatMessage({
													id: "host.auth-request-upstream.placeholder",
												})}
												maxLength={255}
												value={item.npmproAuthRequestUpstream}
												onChange={(e) =>
													handleChange(idx, "npmproAuthRequestUpstream", e.target.value)
												}
											/>
											{item.npmproAuthRequestUpstream &&
											!upstreamUrlPattern.test(item.npmproAuthRequestUpstream) ? (
												<div className="invalid-feedback">
													<T id="error.invalid-upstream-url" />
												</div>
											) : null}
										</div>
									)}
								</div>
							</div>
							<div className="my-3">
								<h4 className="py-2">
									<T id="proxy-host.access-lists" />
								</h4>
								<AccessFields
									initialAccessListType={item?.npmproAccessListType}
									location={item.path}
									initialAccessListIds={item?.npmproAccessListIds}
									onChange={(changes) => handleAccessFieldsChange(idx, changes)}
									authRequest={item.npmproAuthRequest}
								/>
							</div>
						</div>
						{advVisible.includes(item.uiKey) && (
							<div className="">
								<label className="form-label" htmlFor={`advancedConfig-${item.uiKey}`}>
									<T id="location.config.label" />
								</label>
								<textarea
									id={`advancedConfig-${item.uiKey}`}
									className="form-control font-monospace"
									spellCheck={false}
									placeholder={intl.formatMessage({
										id: "nginx-config.placeholder",
									})}
									value={item.advancedConfig}
									onChange={(e) => handleChange(idx, "advancedConfig", e.target.value)}
									rows={8}
									readOnly={!isAdmin}
									aria-describedby={isAdmin ? undefined : `advancedConfig-hint-${item.uiKey}`}
								/>
								{!isAdmin && (
									<div className="form-hint" id={`advancedConfig-hint-${item.uiKey}`}>
										<T id="nginx-config.admin-only" />
									</div>
								)}
							</div>
						)}
					</div>
				</div>
			))}
		</>
	);
}
