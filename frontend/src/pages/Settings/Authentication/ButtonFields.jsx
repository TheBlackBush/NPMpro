import { CircleCheck } from "lucide-react";
import { useId, useState } from "react";
import { useController, useFormContext, useWatch } from "react-hook-form";
import { ApiErrorContent, Button, ErrorAlert, OIDC_ICON_COMPONENTS, OidcButton, TextField } from "src/components";
import { Input } from "src/components/ui/input";
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
import { SettingsCard } from "../SettingsCard";
import { StatusAlert } from "../StatusAlert";

const ICON_URL = /^https?:\/\/[^\s/$.?#].[^\s]*$/u;

// the card of a picker radio: the native radio is hidden but stays the focus and keyboard target
const PICK_CARD =
	"flex h-9 items-center gap-2 rounded-md border px-3 text-sm peer-checked:border-primary peer-checked:bg-primary/10 peer-focus-visible:ring-2 peer-focus-visible:ring-ring";

const SOURCES = ["builtin", "upload", "url"];
const ICON_ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml";

// The icon the button uses: a pending built-in pick, else what is stored
const effectiveIcon = (pick, stored) => {
	if (pick) return { type: "builtin", name: pick };
	if (stored?.type === "file") return { type: "file", url: oidcIconUrl(stored.updatedOn) };
	return stored ?? { type: "builtin", name: "key" };
};

// the colour: presets, a picker and the hex text on one controller; a change shows its message at once
function ColorFields() {
	const { trigger } = useFormContext();
	const { field, fieldState } = useController({ name: "buttonColor" });
	const groupId = useId();
	const color = field.value ?? "";
	const invalid = !isOidcColor(color);
	const setColor = (value) => {
		field.onChange(value);
		void trigger("buttonColor");
	};
	return (
		<div className="space-y-2">
			<div className="text-sm font-medium" id={`${groupId}-label`}>
				<T id="settings.authentication.button.color" />
			</div>
			<div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby={`${groupId}-label`}>
				{OIDC_COLOR_PRESETS.map((preset) => (
					<label className="cursor-pointer" key={preset.name}>
						<input
							type="radio"
							name={`${groupId}-preset`}
							className="peer sr-only"
							value={preset.value}
							aria-label={intl.formatMessage({
								id: `settings.authentication.button.color.${preset.name}`,
							})}
							checked={color.toLowerCase() === preset.value}
							onChange={() => setColor(preset.value)}
						/>
						{/* inline because the preset colours are data (Tabler palette values), not classes */}
						<span
							className="block size-7 rounded-md border ring-offset-background peer-checked:ring-2 peer-checked:ring-ring peer-checked:ring-offset-2 peer-focus-visible:ring-2 peer-focus-visible:ring-ring"
							style={{ backgroundColor: preset.value }}
						/>
					</label>
				))}
			</div>
			<div className="flex items-center gap-2">
				<input
					type="color"
					className="h-9 w-12 cursor-pointer rounded-md border bg-transparent p-1"
					aria-label={intl.formatMessage({ id: "settings.authentication.button.color.custom" })}
					value={validOidcColor(color).toLowerCase()}
					onChange={(e) => setColor(e.target.value)}
				/>
				<Input
					ref={field.ref}
					name={field.name}
					type="text"
					aria-label={intl.formatMessage({ id: "settings.authentication.button.color.hex" })}
					aria-invalid={invalid}
					aria-describedby={invalid ? `${groupId}-hex-error` : undefined}
					autoComplete="off"
					spellCheck={false}
					maxLength={7}
					placeholder="#rrggbb"
					value={color}
					onBlur={field.onBlur}
					onChange={(e) => setColor(e.target.value.trim())}
				/>
			</div>
			{invalid ? (
				<div className="text-sm text-destructive" id={`${groupId}-hex-error`}>
					{fieldState.error?.message}
				</div>
			) : null}
		</div>
	);
}

// the icon: a built-in pick is a field of the form (null keeps the stored icon); an upload, a download or a removal
// saves at once and drops the pick
function IconFields({ storedIcon }) {
	const { field } = useController({ name: "buttonIcon" });
	const [source, setSource] = useState(storedIcon?.type === "file" ? "upload" : "builtin");
	const [url, setUrl] = useState("");
	// the backend's rule (schema/paths/settings/oidc/icon/url/post.json)
	const urlInvalid = url.trim() !== "" && !(url.trim().length <= 2048 && ICON_URL.test(url.trim()));
	const [result, setResult] = useState(null);
	const upload = useUploadOidcIcon();
	const download = useDownloadOidcIcon();
	const remove = useDeleteOidcIcon();
	const busy = upload.isPending || download.isPending || remove.isPending;
	const groupId = useId();

	const callbacks = (messageId) => ({
		onSuccess: () => {
			field.onChange(null);
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

	const selected = field.value ?? (storedIcon?.type === "builtin" ? storedIcon.name : null);

	return (
		<div className="space-y-2">
			<div className="text-sm font-medium" id={`${groupId}-label`}>
				<T id="settings.authentication.button.icon" />
			</div>
			<div
				className="flex flex-wrap gap-2"
				role="radiogroup"
				aria-label={intl.formatMessage({ id: "settings.authentication.button.icon.source" })}
			>
				{SOURCES.map((s) => (
					<label className="cursor-pointer" key={s}>
						<input
							type="radio"
							name={`${groupId}-source`}
							value={s}
							className="peer sr-only"
							checked={source === s}
							onChange={() => {
								setSource(s);
								setResult(null);
							}}
						/>
						<span className={PICK_CARD}>
							<T id={`settings.authentication.button.icon.source.${s}`} />
						</span>
					</label>
				))}
			</div>
			{source === "builtin" ? (
				<div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby={`${groupId}-label`}>
					{OIDC_BUILTIN_ICONS.map((name, index) => {
						const Icon = OIDC_ICON_COMPONENTS[name];
						return (
							<label className="cursor-pointer" key={name}>
								<input
									ref={index === 0 ? field.ref : undefined}
									type="radio"
									name={`${groupId}-builtin`}
									value={name}
									className="peer sr-only"
									aria-label={intl.formatMessage({
										id: `settings.authentication.button.icon.${name}`,
									})}
									checked={selected === name}
									onBlur={field.onBlur}
									onChange={() => {
										field.onChange(name);
										setResult(null);
									}}
								/>
								<span className={PICK_CARD}>
									<Icon className="size-4" aria-hidden="true" />
								</span>
							</label>
						);
					})}
				</div>
			) : null}
			{source === "upload" ? (
				<>
					<Input
						type="file"
						accept={ICON_ACCEPT}
						aria-label={intl.formatMessage({ id: "settings.authentication.button.icon.source.upload" })}
						aria-describedby={`${groupId}-upload-hint`}
						aria-disabled={busy}
						onChange={onFile}
					/>
					<div className="text-sm text-muted-foreground" id={`${groupId}-upload-hint`}>
						<T
							id="settings.authentication.button.icon.upload.hint"
							data={{ kb: OIDC_ICON_MAX_BYTES / 1024 }}
						/>
					</div>
				</>
			) : null}
			{source === "url" ? (
				<>
					<div className="flex gap-2">
						<Input
							type="url"
							aria-invalid={urlInvalid ? "true" : undefined}
							aria-describedby={urlInvalid ? "oidc-icon-url-error" : undefined}
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
							disabled={busy || !url.trim() || urlInvalid}
							onClick={onDownload}
						>
							<T id="settings.authentication.button.icon.download" />
						</Button>
					</div>
					{urlInvalid ? (
						<div className="text-sm text-destructive" id="oidc-icon-url-error">
							<T id="settings.authentication.button.icon.url.invalid" />
						</div>
					) : null}
				</>
			) : null}
			{storedIcon?.type === "file" ? (
				<div>
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
				{result?.ok ? <StatusAlert variant="success" icon={CircleCheck} id={result.messageId} /> : null}
			</div>
			{result && !result.ok ? (
				<ErrorAlert className="mt-3" onClose={() => setResult(null)}>
					<ApiErrorContent error={result.error} />
				</ErrorAlert>
			) : null}
		</div>
	);
}

const PREVIEW_FIELDS = ["buttonLabel", "buttonColor", "buttonIcon"];

function ButtonFields({ data }) {
	const watched = useWatch({ name: PREVIEW_FIELDS });
	const [buttonLabel, buttonColor, buttonIcon] = watched;
	const icon = effectiveIcon(buttonIcon, data.button?.icon);
	return (
		<SettingsCard title={<T id="settings.authentication.button" />}>
			<TextField
				name="buttonLabel"
				id="oidc-buttonLabel"
				label={<T id="settings.authentication.button.label" />}
				hint={<T id="settings.authentication.button.label.hint" />}
				type="text"
				maxLength={40}
				autoComplete="off"
				className=""
			/>
			<ColorFields />
			<IconFields storedIcon={data.button?.icon} />
			<div className="rounded-lg border p-4">
				<div className="mb-2 text-sm font-medium">
					<T id="settings.authentication.button.preview" />
				</div>
				{/* inert: the preview is not interactive and stays out of the tab order */}
				<div inert>
					<OidcButton label={buttonLabel} color={buttonColor} icon={icon} />
				</div>
			</div>
		</SettingsCard>
	);
}

export { ButtonFields };
