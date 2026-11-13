import { ExternalLink, Upload } from "lucide-react";
import { useRef } from "react";
import { get, useFormContext, useFormState, useWatch } from "react-hook-form";
import { CodeText } from "src/components/CodeText";
import { Button } from "src/components/ui/button";
import { cn } from "src/lib/utils";
import { intl, T } from "src/locale";
import { choiceLabelId, hasPreview, readPageFile } from "src/modules/LandingPageForms";
import { SelectField, TextField } from "./FormField";
import { useReadOnly } from "./HookForm";

// "Upload .html": the file replaces the field's text; a file that is too large or not UTF-8 shows on the field
function UploadButton({ htmlName }) {
	const { setValue, setError } = useFormContext();
	const input = useRef(null);
	const onFile = async (event) => {
		const [file] = event.target.files ?? [];
		event.target.value = "";
		if (!file) return;
		const read = readPageFile(new Uint8Array(await file.arrayBuffer()));
		if (read.error) setError(htmlName, { type: "manual", message: intl.formatMessage({ id: read.error }) });
		else setValue(htmlName, read.html, { shouldDirty: true, shouldValidate: true });
	};
	return (
		<>
			<input
				ref={input}
				type="file"
				accept=".html,.htm,text/html"
				className="hidden"
				onChange={onFile}
				data-page-upload={htmlName}
			/>
			<Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
				<Upload className="size-4" aria-hidden="true" />
				<T id="landing-pages.upload" />
			</Button>
		</>
	);
}

/**
 * The saved value of a field (the form's defaultValues). dirtyFields is read so that a reset to the saved values
 * (useResetToSaved after a save) renders the caller again.
 *
 * @param   {string} name
 * @returns {*}
 */
function useSavedValue(name) {
	const { defaultValues, dirtyFields: _dirtyFields } = useFormState({ name });
	return get(defaultValues, name);
}

// opens the saved page in a new tab; with unsaved changes in the row it says that the saved page is shown
function PreviewLink({ href, names, title }) {
	const { getFieldState } = useFormContext();
	const state = useFormState({ name: names });
	const dirty = names.some((name) => getFieldState(name, state).isDirty);
	const text = intl.formatMessage({ id: dirty ? "landing-pages.preview.saved" : "landing-pages.preview" });
	return (
		<Button asChild variant="outline" size="icon" className="shrink-0">
			<a href={href} target="_blank" rel="noopener noreferrer" title={text}>
				<ExternalLink aria-hidden="true" />
				<span className="sr-only">
					{text}
					{title ? <>: {title}</> : null}
				</span>
			</a>
		</Button>
	);
}

// the status codes of a page as small monospace badges
function CodeBadges({ codes }) {
	return (codes ?? []).map((code) => (
		<span
			key={code}
			className="rounded-md border bg-muted px-1.5 py-px font-mono text-[11px] font-semibold text-muted-foreground"
		>
			{code}
		</span>
	));
}

/**
 * One line of the landing page lists, in Settings and in the host and access list windows: the name (semibold) with
 * its status codes as badges and a short hint on the left, the control and the Preview icon on the right. The line
 * stacks (text above, control full width) when its container is narrow. The editor goes right under the line.
 * Lines sit in a PageLines card.
 *
 * @param {Object} props
 * @param {string} props.id
 * @param {*}      props.title      the page name
 * @param {string[]} [props.codes]  status codes, shown as badges
 * @param {*}      [props.hint]
 * @param {*}      props.control    the select
 * @param {*}      [props.preview]  the Preview icon
 * @param {*}      [props.editor]   under the line (PageEditor)
 */
function PageLine({ id, title, codes, hint, control, preview, editor }) {
	return (
		<div className="@container">
			<div className="flex flex-col gap-2 px-4 py-3 @lg:flex-row @lg:items-center @lg:gap-4">
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<p id={`${id}-title`} className="text-sm font-semibold">
							{title}
						</p>
						<CodeBadges codes={codes} />
					</div>
					{hint ? (
						<p id={`${id}-description`} className="mt-0.5 text-[0.8rem] text-muted-foreground">
							{hint}
						</p>
					) : null}
				</div>
				<div className="flex items-center gap-2 @lg:shrink-0">
					<div className="min-w-0 flex-1 @lg:w-56 @lg:flex-none">{control}</div>
					{preview ?? null}
				</div>
			</div>
			{editor}
		</div>
	);
}

/** The bordered card that holds PageLine lines, a hairline between them. */
function PageLines({ children, className }) {
	return <div className={cn("divide-y overflow-hidden rounded-lg border bg-card", className)}>{children}</div>;
}

/** The area under a line while it needs more fields: a muted background and a dashed top border. */
function PageEditor({ children }) {
	return <div className="space-y-3 border-t border-dashed bg-muted/50 px-4 py-3">{children}</div>;
}

/**
 * A landing page choice of the form around it as one PageLine: the dropdown and the Preview icon (admins:
 * previewHref, the saved page; only when the saved choice shows a page, as the backend preview reads the saved row),
 * and for "Custom page" the HTML field with "Upload .html", for this place only.
 *
 * @param {Object}   props
 * @param {string}   props.name       the choice field
 * @param {string}   props.htmlName   the HTML field
 * @param {string}   [props.id]
 * @param {*}        props.title      the page name; it also names the dropdown, the HTML field and Preview for screen readers
 * @param {string[]} [props.codes]    status codes
 * @param {*}        [props.hint]
 * @param {string[]} props.choices
 * @param {{ api: string }} props.field  for the choice labels (choiceLabelId)
 * @param {string|null} [props.previewHref]
 */
function PageChoiceField({
	name,
	htmlName,
	id = name.replaceAll(".", "-"),
	title,
	codes,
	hint,
	choices,
	field,
	previewHref,
}) {
	const choice = useWatch({ name });
	const saved = useSavedValue(name);
	const readOnly = useReadOnly();
	return (
		<PageLine
			id={id}
			title={title}
			codes={codes}
			hint={hint}
			control={
				<SelectField
					name={name}
					id={id}
					label={<span className="sr-only">{title}</span>}
					describedBy={hint ? `${id}-description` : undefined}
					className="mb-0 gap-0"
				>
					{choices.map((value) => (
						<option key={value} value={value}>
							{intl.formatMessage({ id: choiceLabelId(field, value) })}
						</option>
					))}
				</SelectField>
			}
			preview={
				previewHref && hasPreview(saved) ? (
					<PreviewLink href={previewHref} names={[name, htmlName]} title={title} />
				) : null
			}
			editor={
				choice === "custom" ? (
					<PageEditor>
						<TextField
							name={htmlName}
							id={`${id}-html`}
							label={
								<span className="sr-only">
									<T id="landing-pages.html" />: {title}
								</span>
							}
							hint={<CodeText>{intl.formatMessage({ id: "landing-pages.html.hint" })}</CodeText>}
							describedBy={hint ? `${id}-description` : undefined}
							as="textarea"
							rows={8}
							controlClassName="bg-background font-mono text-xs"
							spellCheck={false}
							placeholder="<!DOCTYPE html>"
							className="mb-0 gap-1.5"
						/>
						{readOnly ? null : <UploadButton htmlName={htmlName} />}
					</PageEditor>
				) : null
			}
		/>
	);
}

export { PageChoiceField, PageEditor, PageLine, PageLines, PreviewLink, useSavedValue };
