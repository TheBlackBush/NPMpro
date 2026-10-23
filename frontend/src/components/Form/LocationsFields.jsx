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
import { useFormikContext } from "formik";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { AccessFields, SwitchField } from "src/components";
import { intl, T } from "src/locale";
import { forwardSummary } from "src/modules/Forward";
import { getOptionHintId } from "src/modules/ProxyOptions";
import { upstreamUrlPattern } from "src/modules/Validations";
import { NoticeAlert } from "../NoticeAlert";

export function LocationsFields({ initialValues, name = "locations" }) {
	const nextUiKey = useRef(0);
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
	const { setFieldValue } = useFormikContext();
	const [advVisible, setAdvVisible] = useState([]);
	const [expanded, setExpanded] = useState([]);
	const [filter, setFilter] = useState("");
	const scrollToKey = useRef(null);

	const toggle = (key, list, set) => set(list.includes(key) ? list.filter((i) => i !== key) : [...list, key]);

	const handleAdd = () => {
		const item = createUiLocation();
		const newValues = [...values, item];
		setValues(newValues);
		setExpanded([...expanded, item.uiKey]);
		setFilter("");
		scrollToKey.current = item.uiKey;
	};

	const handleRemove = (idx) => {
		const newValues = values.filter((_, i) => i !== idx);
		setValues(newValues);
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
		const filtered = newValues.filter((v) => v?.path?.trim() !== "").map(({ uiKey, ...rest }) => rest);
		void setFieldValue(name, filtered);
	};

	const isOpen = (item) => expanded.includes(item.uiKey);

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
					className={cn("card", "card-active", "mb-2", !matchesFilter(item) && "d-none")}
					style={{ "--tblr-card-border-color": "var(--tblr-border-color)" }}
				>
					<div className={cn("card-header", "p-2", !isOpen(item) && "border-bottom-0")}>
						<button
							type="button"
							className="d-flex flex-fill align-self-stretch align-items-center overflow-hidden p-0 text-start text-body bg-transparent border-0"
							aria-expanded={isOpen(item)}
							aria-controls={`location-body-${item.uiKey}`}
							onClick={() => toggle(item.uiKey, expanded, setExpanded)}
						>
							{isOpen(item) ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
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
					<div
						className={cn("card-body", !isOpen(item) && "d-none")}
						id={`location-body-${item.uiKey}`}
						onInvalid={() =>
							flushSync(() => {
								setFilter("");
								setExpanded((keys) => (keys.includes(item.uiKey) ? keys : [...keys, item.uiKey]));
							})
						}
					>
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
										className="form-control"
										placeholder="/path"
										autoComplete="off"
										required
										pattern="\S{1,255}"
										value={item.path}
										onChange={(e) => handleChange(idx, "path", e.target.value)}
									/>
								</div>
							</div>
							<div className="col-md-2 text-end">
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
										type="text"
										className="form-control"
										required={item.forwardScheme !== "empty"}
										pattern="(?=\S{0,255}$)[^\s\/]{0,253}(\/\S*)?"
										placeholder={intl.formatMessage(
											{ id: "form.example" },
											{ example: "10.0.0.1/path/" },
										)}
										value={item.forwardHost}
										onChange={(e) => handleChange(idx, "forwardHost", e.target.value)}
									/>
								</div>
							</div>
							<div className="col-md-3">
								<div className="mb-3">
									<label className="form-label" htmlFor={`forwardPort-${item.uiKey}`}>
										<T id="host.forward-port" />
									</label>
									<input
										id={`forwardPort-${item.uiKey}`}
										type="number"
										min={1}
										max={65535}
										className="form-control"
										placeholder={intl.formatMessage({ id: "form.example" }, { example: "8081" })}
										value={item.forwardPort || ""}
										onChange={(e) => handleChange(idx, "forwardPort", e.target.value)}
									/>
								</div>
							</div>

							<div className="my-3">
								<h4 className="py-2">
									<T id="options" />
								</h4>
								<div className="divide-y">
									<div>
										<SwitchField
											id={`npmproNoindex-${item.uiKey}`}
											label={<T id="host.flags.send-noindex" />}
											checked={item.npmproNoindex}
											onChange={(e) => handleChange(idx, "npmproNoindex", e.target.checked)}
										/>
									</div>
									<div>
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
											onChange={(e) =>
												handleChange(idx, "npmproCrowdsecAppsec", e.target.checked)
											}
										/>
									</div>
									<div>
										<SwitchField
											id={`npmproProxyRequestBuffering-${item.uiKey}`}
											label={<T id="host.flags.disable-request-buffering" />}
											hint={
												<>
													<span className="d-block">
														<T id="host.flags.hint.request-buffering-appsec" />
													</span>
													{getOptionHintId(
														"npmproProxyRequestBuffering",
														item.forwardScheme,
													) && (
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
									</div>
									<div>
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
									</div>
									<div>
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
									</div>
									<div>
										<SwitchField
											id={`npmproFancyindex-${item.uiKey}`}
											label={<T id="host.flags.fancyindex" />}
											hint={
												getOptionHintId("npmproFancyindex", item.forwardScheme) && (
													<span className="d-block">
														<T
															id={getOptionHintId("npmproFancyindex", item.forwardScheme)}
														/>
													</span>
												)
											}
											checked={item.npmproFancyindex}
											onChange={(e) => handleChange(idx, "npmproFancyindex", e.target.checked)}
											disabled={item.forwardScheme !== "path"}
										/>
									</div>
									<div>
										<label
											className="row cursor-pointer"
											htmlFor={`npmproXFrameOptions-${item.uiKey}`}
										>
											<span className="col">X-Frame-Options</span>
											<span className="col-auto">
												<select
													id={`npmproXFrameOptions-${item.uiKey}`}
													className="form-select"
													value={item.npmproXFrameOptions}
													onChange={(e) =>
														handleChange(idx, "npmproXFrameOptions", e.target.value)
													}
												>
													<option value="SAMEORIGIN">SAMEORIGIN</option>
													<option value="DENY">DENY</option>
													<option value="none">none</option>
													<option value="upstream">upstream</option>
												</select>
											</span>
										</label>
									</div>
									<div>
										<label
											className="row cursor-pointer"
											htmlFor={`npmproAuthRequest-${item.uiKey}`}
										>
											<span className="col">
												<T id="host.auth-request" />
											</span>
											<span className="col-auto">
												<select
													id={`npmproAuthRequest-${item.uiKey}`}
													className="form-select"
													value={item.npmproAuthRequest}
													onChange={(e) =>
														handleChange(idx, "npmproAuthRequest", e.target.value)
													}
												>
													<option value="none">none</option>
													<option value="anubis">anubis</option>
													<option value="tinyauth">tinyauth</option>
													<option value="oauth2proxy">oauth2proxy</option>
													<option value="voidauth">voidauth</option>
													<option value="authelia">authelia (modern)</option>
													<option value="authentik">authentik</option>
													<option value="authentik-send-basic-auth">
														authentik-send-basic-auth
													</option>
												</select>
											</span>
										</label>
									</div>
									{item?.npmproAuthRequest?.length > 0 && item.npmproAuthRequest !== "none" && (
										<div>
											<label
												className="row cursor-pointer"
												htmlFor={`npmproAuthRequestUpstream-${item.uiKey}`}
											>
												<span className="col">
													<T id="host.auth-request-upstream" />
												</span>
												<span className="col-auto">
													<input
														id={`npmproAuthRequestUpstream-${item.uiKey}`}
														type="text"
														className={`form-control ${item.npmproAuthRequestUpstream && !upstreamUrlPattern.test(item.npmproAuthRequestUpstream) ? "is-invalid" : ""}`}
														placeholder={intl.formatMessage({
															id: "host.auth-request-upstream.placeholder",
														})}
														maxLength={255}
														pattern="^https?://(([^\s\/:]+|\[[a-fA-F0-9:]+\]):[0-9]+|cu_[^\s\/:]+)$"
														value={item.npmproAuthRequestUpstream}
														onChange={(e) =>
															handleChange(
																idx,
																"npmproAuthRequestUpstream",
																e.target.value,
															)
														}
													/>

													{item.npmproAuthRequestUpstream &&
													!upstreamUrlPattern.test(item.npmproAuthRequestUpstream) ? (
														<div className="invalid-feedback">
															<T id="error.invalid-upstream-url" />
														</div>
													) : null}
												</span>
											</label>
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
								/>
							</div>
						)}
					</div>
				</div>
			))}
		</>
	);
}
