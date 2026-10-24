import { IconCircleCheck } from "@tabler/icons-react";
import { useFormikContext } from "formik";
import { useId, useState } from "react";
import { ApiErrorContent, Button, ErrorAlert, OIDC_ICON_COMPONENTS, OidcButton } from "src/components";
import { useDeleteOidcIcon, useDownloadOidcIcon, useUploadOidcIcon } from "src/hooks";
import { intl, T } from "src/locale";
import {
	isOidcColor,
	OIDC_BUILTIN_ICONS,
	OIDC_COLOR_PRESETS,
	OIDC_ICON_MAX_BYTES,
	oidcIconUrl,
	validOidcColor,
} from "src/modules/Oidc";

const SOURCES = ["builtin", "upload", "url"];
const ICON_ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml";

// The icon the button uses: a pending built-in pick, else what is stored
const effectiveIcon = (pick, stored) => {
	if (pick) return { type: "builtin", name: pick };
	if (stored?.type === "file") return { type: "file", url: oidcIconUrl(stored.updatedOn) };
	return stored ?? { type: "builtin", name: "key" };
};

function ColorFields() {
	const { values, setFieldValue, errors } = useFormikContext();
	const groupId = useId();
	const color = values.buttonColor ?? "";
	const invalid = !isOidcColor(color);
	return (
		<div className="mb-3">
			<div className="form-label" id={`${groupId}-label`}>
				<T id="settings.authentication.button.color" />
			</div>
			<div className="d-flex flex-wrap gap-2 mb-2" role="radiogroup" aria-labelledby={`${groupId}-label`}>
				{OIDC_COLOR_PRESETS.map((preset) => (
					<label className="form-colorinput" key={preset.name}>
						<input
							type="radio"
							name={`${groupId}-preset`}
							className="form-colorinput-input"
							value={preset.value}
							aria-label={intl.formatMessage({
								id: `settings.authentication.button.color.${preset.name}`,
							})}
							checked={color.toLowerCase() === preset.value}
							onChange={() => setFieldValue("buttonColor", preset.value)}
						/>
						{/* inline because the preset colours are data (Tabler palette values), not classes */}
						<span className="form-colorinput-color" style={{ backgroundColor: preset.value }} />
					</label>
				))}
			</div>
			<div className="row g-2">
				<div className="col-auto">
					<input
						type="color"
						className="form-control form-control-color"
						aria-label={intl.formatMessage({ id: "settings.authentication.button.color.custom" })}
						value={validOidcColor(color).toLowerCase()}
						onChange={(e) => setFieldValue("buttonColor", e.target.value)}
					/>
				</div>
				<div className="col">
					<input
						type="text"
						className={`form-control${invalid ? " is-invalid" : ""}`}
						aria-label={intl.formatMessage({ id: "settings.authentication.button.color.hex" })}
						aria-invalid={invalid}
						aria-describedby={invalid ? `${groupId}-hex-error` : undefined}
						autoComplete="off"
						spellCheck={false}
						maxLength={7}
						placeholder="#rrggbb"
						value={color}
						onChange={(e) => setFieldValue("buttonColor", e.target.value.trim())}
					/>
					{invalid ? (
						<div className="invalid-feedback" id={`${groupId}-hex-error`}>
							{errors.buttonColor}
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}

function IconFields({ storedIcon }) {
	const { values, setFieldValue } = useFormikContext();
	const [source, setSource] = useState(storedIcon?.type === "file" ? "upload" : "builtin");
	const [url, setUrl] = useState("");
	const [result, setResult] = useState(null);
	const upload = useUploadOidcIcon();
	const download = useDownloadOidcIcon();
	const remove = useDeleteOidcIcon();
	const busy = upload.isPending || download.isPending || remove.isPending;
	const groupId = useId();

	const callbacks = (messageId) => ({
		onSuccess: () => {
			void setFieldValue("buttonIcon", null);
			setResult({ ok: true, messageId });
		},
		onError: (err) => setResult({ ok: false, error: err }),
	});

	const onFile = (e) => {
		const file = e.target.files?.[0];
		// reset so that the same file can be picked again, without remounting or disabling (keeps the focus)
		e.target.value = "";
		if (!file || busy) return;
		setResult(null);
		upload.mutate(file, callbacks("settings.authentication.button.icon.uploaded"));
	};

	const onDownload = () => {
		setResult(null);
		const done = callbacks("settings.authentication.button.icon.downloaded");
		download.mutate(url, {
			...done,
			onSuccess: () => {
				done.onSuccess();
				setUrl("");
			},
		});
	};

	const onRemove = () => {
		setResult(null);
		remove.mutate(undefined, callbacks("settings.authentication.button.icon.removed"));
	};

	const selected = values.buttonIcon ?? (storedIcon?.type === "builtin" ? storedIcon.name : null);

	return (
		<div className="mb-3">
			<div className="form-label" id={`${groupId}-label`}>
				<T id="settings.authentication.button.icon" />
			</div>
			<div className="mb-3">
				<div
					className="form-selectgroup"
					role="radiogroup"
					aria-label={intl.formatMessage({ id: "settings.authentication.button.icon.source" })}
				>
					{SOURCES.map((s) => (
						<label className="form-selectgroup-item" key={s}>
							<input
								type="radio"
								name={`${groupId}-source`}
								value={s}
								className="form-selectgroup-input"
								checked={source === s}
								onChange={() => {
									setSource(s);
									setResult(null);
								}}
							/>
							<span className="form-selectgroup-label">
								<T id={`settings.authentication.button.icon.source.${s}`} />
							</span>
						</label>
					))}
				</div>
			</div>
			{source === "builtin" ? (
				<div className="form-selectgroup" role="radiogroup" aria-labelledby={`${groupId}-label`}>
					{OIDC_BUILTIN_ICONS.map((name) => {
						const Icon = OIDC_ICON_COMPONENTS[name];
						return (
							<label className="form-selectgroup-item" key={name}>
								<input
									type="radio"
									name={`${groupId}-builtin`}
									value={name}
									className="form-selectgroup-input"
									aria-label={intl.formatMessage({
										id: `settings.authentication.button.icon.${name}`,
									})}
									checked={selected === name}
									onChange={() => {
										void setFieldValue("buttonIcon", name);
										setResult(null);
									}}
								/>
								<span className="form-selectgroup-label">
									<Icon className="icon" aria-hidden="true" />
								</span>
							</label>
						);
					})}
				</div>
			) : null}
			{source === "upload" ? (
				<>
					<input
						type="file"
						className="form-control"
						accept={ICON_ACCEPT}
						aria-label={intl.formatMessage({ id: "settings.authentication.button.icon.source.upload" })}
						aria-describedby={`${groupId}-upload-hint`}
						aria-disabled={busy}
						onChange={onFile}
					/>
					<div className="form-hint" id={`${groupId}-upload-hint`}>
						<T
							id="settings.authentication.button.icon.upload.hint"
							data={{ kb: OIDC_ICON_MAX_BYTES / 1024 }}
						/>
					</div>
				</>
			) : null}
			{source === "url" ? (
				<div className="input-group">
					<input
						type="url"
						className="form-control"
						aria-label={intl.formatMessage({ id: "settings.authentication.button.icon.source.url" })}
						placeholder="https://"
						autoComplete="off"
						value={url}
						disabled={busy}
						onChange={(e) => setUrl(e.target.value)}
					/>
					<Button
						outline
						color="secondary"
						isLoading={download.isPending}
						disabled={busy || !url.trim()}
						onClick={onDownload}
					>
						<T id="settings.authentication.button.icon.download" />
					</Button>
				</div>
			) : null}
			{storedIcon?.type === "file" ? (
				<div className="mt-3">
					<Button
						outline
						color="danger"
						size="sm"
						isLoading={remove.isPending}
						disabled={busy}
						onClick={onRemove}
					>
						<T id="settings.authentication.button.icon.remove" />
					</Button>
				</div>
			) : null}
			<div role="status">
				{result?.ok ? (
					<div className="alert alert-success mt-3 mb-0">
						<div className="alert-icon">
							<IconCircleCheck className="icon" aria-hidden="true" />
						</div>
						<div className="text-break">
							<T id={result.messageId} />
						</div>
					</div>
				) : null}
			</div>
			{result && !result.ok ? (
				<ErrorAlert className="mt-3 mb-0" onClose={() => setResult(null)}>
					<ApiErrorContent error={result.error} />
				</ErrorAlert>
			) : null}
		</div>
	);
}

function ButtonFields({ data }) {
	const { values, handleChange, handleBlur, errors, touched, submitCount } = useFormikContext();
	const labelInvalid = Boolean(errors.buttonLabel) && (touched.buttonLabel || submitCount > 0);
	const labelId = "oidc-buttonLabel";
	const icon = effectiveIcon(values.buttonIcon, data.button?.icon);
	return (
		<div className="mb-4">
			<h3 className="card-title">
				<T id="settings.authentication.button" />
			</h3>
			<div className="mb-3">
				<label className="form-label" htmlFor={labelId}>
					<T id="settings.authentication.button.label" />
				</label>
				<input
					id={labelId}
					name="buttonLabel"
					type="text"
					className={`form-control${labelInvalid ? " is-invalid" : ""}`}
					maxLength={40}
					autoComplete="off"
					aria-invalid={labelInvalid}
					aria-describedby={`${labelId}-hint`}
					value={values.buttonLabel ?? ""}
					onChange={handleChange}
					onBlur={handleBlur}
				/>
				{labelInvalid ? <div className="invalid-feedback">{errors.buttonLabel}</div> : null}
				<div className="form-hint" id={`${labelId}-hint`}>
					<T id="settings.authentication.button.label.hint" />
				</div>
			</div>
			<ColorFields />
			<IconFields storedIcon={data.button?.icon} />
			<div className="card card-sm">
				<div className="card-body">
					<div className="form-label">
						<T id="settings.authentication.button.preview" />
					</div>
					{/* inert: the preview is not interactive and stays out of the tab order */}
					<div inert>
						<OidcButton label={values.buttonLabel} color={values.buttonColor} icon={icon} />
					</div>
				</div>
			</div>
		</div>
	);
}

export { ButtonFields };
