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
import { useLayoutEffect, useRef, useState } from "react";
import { useFieldArray, useFormContext, useFormState, useWatch } from "react-hook-form";
import { AccessFields, SwitchField } from "src/components";
import { useIsAdmin } from "src/hooks";
import { intl, T } from "src/locale";
import { forwardSummary } from "src/modules/Forward";
import { applyChanges } from "src/modules/HookForm";
import { newLocation } from "src/modules/ProxyHostForms";
import { getOptionHintId, proxyOptionChanges } from "src/modules/ProxyOptions";
import { NoticeAlert } from "../NoticeAlert";
import { useListRecheck, useRecheckDependent } from "./HookForm";

const locationLabel = (row) => `${row.locationType}${row.path}`;

// one custom location: a card with its header (path, target, config marker) and, while open, its fields; row is
// the row's current values (the controlled field of LocationsFields)
function LocationRow({
	name,
	index,
	rowKey,
	row,
	isAdmin,
	open,
	hidden,
	advOpen,
	onToggle,
	onToggleAdv,
	onRemove,
	recheckPaths,
	cardRef,
}) {
	const { register, getFieldState, setValue, clearErrors } = useFormContext();
	const base = `${name}.${index}`;
	const formState = useFormState({ name: base });
	const recheckPath = useRecheckDependent(`${base}.path`);
	const recheckHost = useRecheckDependent(`${base}.forwardHost`);
	const shownError = (field) => getFieldState(`${base}.${field}`, formState).error?.message ?? null;
	// what a proxy option turns off or on in this row (the option itself is set by register)
	const applyOption = (field, value) => {
		const { [field]: _changed, ...others } = proxyOptionChanges(field, value);
		applyChanges(setValue, others, base);
	};
	const pathError = shownError("path");
	const hostError = shownError("forwardHost");
	const portError = shownError("forwardPort");
	const upstreamError = shownError("npmproAuthRequestUpstream");
	return (
		<div
			ref={cardRef}
			className={cn("card", "card-active", "mb-2", hidden && "d-none")}
			style={{ "--tblr-card-border-color": "var(--tblr-border-color)" }}
		>
			<div className={cn("card-header", "p-2", !open && "border-bottom-0")}>
				<button
					type="button"
					className="d-flex flex-fill align-self-stretch align-items-center overflow-hidden p-0 text-start text-body bg-transparent border-0"
					aria-expanded={open}
					aria-controls={`location-body-${rowKey}`}
					onClick={onToggle}
				>
					{open ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
					<span className="ms-2 fw-medium text-truncate">{locationLabel(row)}</span>
					<span className="ms-2 text-secondary text-truncate">{forwardSummary(row)}</span>
					{row.advancedConfig?.trim() && (
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
					onClick={onRemove}
				>
					<IconTrash size={16} className="icon" />
				</button>
			</div>
			<div className={cn("card-body", !open && "d-none")} id={`location-body-${rowKey}`}>
				<div className="row mb-3">
					<SwitchField
						id={`npmproEnabled-${rowKey}`}
						label={<T id="enabled" />}
						{...register(`${base}.npmproEnabled`)}
					/>
				</div>
				<div className="row">
					<div className="col-md-10">
						<div className="input-group mb-3">
							<span className="input-group-text">
								<T id="location" />
							</span>
							<select
								id={`locationType-${rowKey}`}
								className="form-select w-auto flex-grow-0"
								{...register(`${base}.locationType`, {
									// the type and the path together must be unique
									onChange: () => {
										recheckPath();
										recheckPaths();
									},
								})}
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
								{...register(`${base}.path`, { onChange: recheckPaths })}
								className={cn("form-control", pathError && "is-invalid")}
								placeholder="/path"
								autoComplete="off"
								required
								aria-label={intl.formatMessage({ id: "location.path" })}
								aria-invalid={pathError ? "true" : undefined}
							/>
							{pathError ? <div className="invalid-feedback">{pathError}</div> : null}
						</div>
					</div>
					<div className="col-md-2 text-end">
						{(isAdmin || row.advancedConfig?.trim()) && (
							<button
								type="button"
								className="btn p-0"
								title={intl.formatMessage({ id: "location.config.toggle" })}
								aria-label={intl.formatMessage({ id: "location.config.toggle" })}
								aria-expanded={advOpen}
								onClick={onToggleAdv}
							>
								<IconSettings size={20} />
								{row.advancedConfig?.trim() ? "*" : ""}
							</button>
						)}
					</div>
				</div>
				{!row.path?.endsWith("/") && (row.locationType === "" || row.locationType === "^~ ") && (
					<NoticeAlert role="status">
						<T id="proxy-host.location-no-trailing-slash-warning" />
					</NoticeAlert>
				)}
				<div className="row">
					<div className="col-md-3">
						<div className="mb-3">
							<label className="form-label" htmlFor={`forwardScheme-${rowKey}`}>
								<T id="host.forward-scheme" />
							</label>
							<select
								id={`forwardScheme-${rowKey}`}
								className="form-control"
								{...register(`${base}.forwardScheme`, {
									onChange: (e) => {
										applyOption("forwardScheme", e.target.value);
										recheckHost();
									},
								})}
							>
								<option value="http">http://</option>
								<option value="https">https://</option>
								<option value="path">{intl.formatMessage({ id: "host.forward-scheme.path" })}</option>
								<option value="empty">{intl.formatMessage({ id: "host.forward-scheme.empty" })}</option>
								<option value="grpc">grpc://</option>
								<option value="grpcs">grpcs://</option>
							</select>
						</div>
					</div>
					<div className="col-md-6">
						<div className="mb-3">
							<label className="form-label" htmlFor={`forwardHost-${rowKey}`}>
								<T id="proxy-host.forward-host-path" />
							</label>
							<input
								id={`forwardHost-${rowKey}`}
								{...register(`${base}.forwardHost`)}
								type="text"
								className={cn("form-control", hostError && "is-invalid")}
								required={row.forwardScheme !== "empty"}
								aria-invalid={hostError ? "true" : undefined}
								placeholder={intl.formatMessage({ id: "form.example" }, { example: "10.0.0.1/path/" })}
							/>
							{hostError ? <div className="invalid-feedback">{hostError}</div> : null}
							{row.forwardScheme === "path" && (
								<div className="form-hint">
									<T id="host.forward-host.path-hint" />
								</div>
							)}
						</div>
					</div>
					<div className="col-md-3">
						<div className="mb-3">
							<label className="form-label" htmlFor={`forwardPort-${rowKey}`}>
								<T id="host.forward-port" />
							</label>
							<input
								id={`forwardPort-${rowKey}`}
								{...register(`${base}.forwardPort`)}
								type="number"
								min={1}
								max={65535}
								className={cn("form-control", portError && "is-invalid")}
								aria-invalid={portError ? "true" : undefined}
								placeholder={intl.formatMessage({ id: "form.example" }, { example: "8081" })}
							/>
							{portError ? <div className="invalid-feedback">{portError}</div> : null}
						</div>
					</div>

					<div className="my-3">
						<h4 className="py-2">
							<T id="options" />
						</h4>
						<div className="divide-y">
							<SwitchField
								id={`npmproNoindex-${rowKey}`}
								label={<T id="host.flags.send-noindex" />}
								{...register(`${base}.npmproNoindex`)}
							/>
							<SwitchField
								id={`npmproCrowdsecAppsec-${rowKey}`}
								label={<T id="host.flags.disable-crowdsec-appsec" />}
								hint={
									row.npmproProxyRequestBuffering && (
										<span className="d-block">
											<T id="host.flags.hint.appsec-request-buffering" />
										</span>
									)
								}
								{...register(`${base}.npmproCrowdsecAppsec`, {
									onChange: (e) => applyOption("npmproCrowdsecAppsec", e.target.checked),
								})}
							/>
							<SwitchField
								id={`npmproProxyRequestBuffering-${rowKey}`}
								label={<T id="host.flags.disable-request-buffering" />}
								hint={
									<>
										<span className="d-block">
											<T id="host.flags.hint.request-buffering-appsec" />
										</span>
										{getOptionHintId("npmproProxyRequestBuffering", row.forwardScheme) && (
											<span className="d-block">
												<T
													id={getOptionHintId(
														"npmproProxyRequestBuffering",
														row.forwardScheme,
													)}
												/>
											</span>
										)}
									</>
								}
								{...register(`${base}.npmproProxyRequestBuffering`, {
									onChange: (e) => applyOption("npmproProxyRequestBuffering", e.target.checked),
								})}
								disabled={!["http", "https"].includes(row.forwardScheme)}
							/>
							<SwitchField
								id={`npmproProxyResponseBuffering-${rowKey}`}
								label={<T id="host.flags.disable-response-buffering" />}
								hint={
									getOptionHintId("npmproProxyResponseBuffering", row.forwardScheme) && (
										<span className="d-block">
											<T
												id={getOptionHintId("npmproProxyResponseBuffering", row.forwardScheme)}
											/>
										</span>
									)
								}
								{...register(`${base}.npmproProxyResponseBuffering`)}
								disabled={!["http", "https"].includes(row.forwardScheme)}
							/>
							<SwitchField
								id={`npmproUpstreamCompression-${rowKey}`}
								label={<T id="host.flags.upstream-compression" />}
								hint={
									getOptionHintId("npmproUpstreamCompression", row.forwardScheme) && (
										<span className="d-block">
											<T id={getOptionHintId("npmproUpstreamCompression", row.forwardScheme)} />
										</span>
									)
								}
								{...register(`${base}.npmproUpstreamCompression`)}
								disabled={["path", "empty"].includes(row.forwardScheme)}
							/>
							<SwitchField
								id={`npmproFancyindex-${rowKey}`}
								label={<T id="host.flags.fancyindex" />}
								hint={
									getOptionHintId("npmproFancyindex", row.forwardScheme) && (
										<span className="d-block">
											<T id={getOptionHintId("npmproFancyindex", row.forwardScheme)} />
										</span>
									)
								}
								{...register(`${base}.npmproFancyindex`)}
								disabled={row.forwardScheme !== "path"}
							/>
						</div>
						<div className="mt-3">
							<div className="mb-3">
								<label className="form-label" htmlFor={`npmproXFrameOptions-${rowKey}`}>
									X-Frame-Options
								</label>
								<select
									id={`npmproXFrameOptions-${rowKey}`}
									className="form-select"
									{...register(`${base}.npmproXFrameOptions`)}
								>
									<option value="SAMEORIGIN">SAMEORIGIN</option>
									<option value="DENY">DENY</option>
									<option value="none">none</option>
									<option value="upstream">upstream</option>
								</select>
							</div>
							<div className="mb-3">
								<label className="form-label" htmlFor={`npmproAuthRequest-${rowKey}`}>
									<T id="host.auth-request" />
								</label>
								<select
									id={`npmproAuthRequest-${rowKey}`}
									className="form-select"
									{...register(`${base}.npmproAuthRequest`, {
										onChange: (e) => {
											applyOption("npmproAuthRequest", e.target.value);
											// the upstream is hidden without an auth request
											if (e.target.value === "none")
												clearErrors(`${base}.npmproAuthRequestUpstream`);
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
							{row.npmproAuthRequest?.length > 0 && row.npmproAuthRequest !== "none" && (
								<div className="mb-3">
									<label className="form-label" htmlFor={`npmproAuthRequestUpstream-${rowKey}`}>
										<T id="host.auth-request-upstream" />
									</label>
									<input
										id={`npmproAuthRequestUpstream-${rowKey}`}
										type="text"
										className={`form-control ${upstreamError ? "is-invalid" : ""}`}
										placeholder={intl.formatMessage({
											id: "host.auth-request-upstream.placeholder",
										})}
										maxLength={255}
										{...register(`${base}.npmproAuthRequestUpstream`)}
									/>
									{upstreamError ? <div className="invalid-feedback">{upstreamError}</div> : null}
								</div>
							)}
						</div>
					</div>
					<div className="my-3">
						<h4 className="py-2">
							<T id="proxy-host.access-lists" />
						</h4>
						<AccessFields
							name={`${base}.npmproAccessListIds`}
							typeName={`${base}.npmproAccessListType`}
							location={row.path}
							authRequest={row.npmproAuthRequest}
						/>
					</div>
				</div>
				{advOpen && (
					<div className="">
						<label className="form-label" htmlFor={`advancedConfig-${rowKey}`}>
							<T id="location.config.label" />
						</label>
						<textarea
							id={`advancedConfig-${rowKey}`}
							className="form-control font-monospace"
							spellCheck={false}
							placeholder={intl.formatMessage({
								id: "nginx-config.placeholder",
							})}
							{...register(`${base}.advancedConfig`)}
							rows={8}
							readOnly={!isAdmin}
							aria-describedby={isAdmin ? undefined : `advancedConfig-hint-${rowKey}`}
						/>
						{!isAdmin && (
							<div className="form-hint" id={`advancedConfig-hint-${rowKey}`}>
								<T id="nginx-config.admin-only" />
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}

/**
 * The custom locations of a proxy host (useFieldArray over the form's locations): a filter, Add, and one card per
 * location. A new card opens and scrolls into view; after a refused save a card with a message is open and shown
 * whatever the filter.
 *
 * @param {Object} props
 * @param {string} [props.name]
 */
export function LocationsFields({ name = "locations" }) {
	const isAdmin = useIsAdmin();
	const { fields, append, remove } = useFieldArray({ name });
	const rows = useWatch({ name });
	// the documented controlled field array: the keys of fields with the current values of the rows (useWatch may
	// still hold the list before an append or a removal)
	const controlledFields = fields.map((field, index) => ({ ...field, ...rows?.[index] }));
	const { errors, isSubmitted } = useFormState({ name });
	const { afterRemove, recheckRows } = useListRecheck(name);
	const [advVisible, setAdvVisible] = useState([]);
	const [expanded, setExpanded] = useState([]);
	const [filter, setFilter] = useState("");
	const scrollToKey = useRef(null);
	const added = useRef(false);

	// the row Add appended: open it and scroll it into view (its key exists once useFieldArray rendered it)
	useLayoutEffect(() => {
		if (!added.current) return;
		added.current = false;
		const key = fields.at(-1)?.id;
		scrollToKey.current = key;
		setExpanded((list) => [...list, key]);
	}, [fields]);

	const toggle = (key, list, set) => set(list.includes(key) ? list.filter((i) => i !== key) : [...list, key]);
	// after a refused save a row with an error is open and not filtered away, so its error can be seen
	const forcedOpen = (index) => isSubmitted && Boolean(errors[name]?.[index]);

	const handleAdd = () => {
		added.current = true;
		append(newLocation(), { shouldFocus: false });
		setFilter("");
	};

	const handleRemove = (index) => {
		remove(index);
		afterRemove();
	};

	const matchesFilter = (row) =>
		`${locationLabel(row)} ${forwardSummary(row)}`.toLowerCase().includes(filter.trim().toLowerCase());

	if (fields.length === 0) {
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
			{!controlledFields.some(matchesFilter) && (
				<div className="text-secondary text-center my-3">
					<T id="empty-search" />
				</div>
			)}
			{controlledFields.map((field, index) => (
				<LocationRow
					key={field.id}
					name={name}
					index={index}
					rowKey={field.id}
					row={field}
					isAdmin={isAdmin}
					open={expanded.includes(field.id) || forcedOpen(index)}
					hidden={!matchesFilter(field) && !forcedOpen(index)}
					advOpen={advVisible.includes(field.id)}
					onToggle={() => toggle(field.id, expanded, setExpanded)}
					onToggleAdv={() => toggle(field.id, advVisible, setAdvVisible)}
					onRemove={() => handleRemove(index)}
					recheckPaths={() => recheckRows("path")}
					cardRef={(node) => {
						if (node && scrollToKey.current === field.id) {
							scrollToKey.current = null;
							node.scrollIntoView({ block: "nearest" });
						}
					}}
				/>
			))}
		</>
	);
}
