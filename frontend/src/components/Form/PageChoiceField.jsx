import { ExternalLink, Upload } from "lucide-react";
import { useRef } from "react";
import { useFormContext, useFormState, useWatch } from "react-hook-form";
import { CodeText } from "src/components/CodeText";
import { Button } from "src/components/ui/button";
import { intl, T } from "src/locale";
import { choiceLabelId, readPageFile } from "src/modules/LandingPageForms";
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

// a label that also names the row for a screen reader ("Page: Page not found (404)")
function NamedLabel({ typeLabel, children }) {
	return (
		<>
			{children}
			{typeLabel ? <span className="sr-only">: {typeLabel}</span> : null}
		</>
	);
}

// opens the saved page in a new tab; with unsaved changes in the row it says that the saved page is shown
function PreviewLink({ href, names }) {
	const { getFieldState } = useFormContext();
	const state = useFormState({ name: names });
	const dirty = names.some((name) => getFieldState(name, state).isDirty);
	return (
		<a
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			className="inline-flex items-center gap-1 text-sm text-primary underline underline-offset-4"
		>
			<T id={dirty ? "landing-pages.preview.saved" : "landing-pages.preview"} />
			<ExternalLink className="size-3.5" aria-hidden="true" />
		</a>
	);
}

/**
 * A landing page choice of the form around it: the dropdown, and for "Custom page" the HTML field with "Upload .html"
 * right below it, for this place only. Preview (admins: previewHref) opens the saved page.
 *
 * @param {Object}   props
 * @param {string}   props.name       the choice field
 * @param {string}   props.htmlName   the HTML field
 * @param {string}   [props.id]
 * @param {*}        props.label
 * @param {*}        [props.typeLabel]   the page type, read by screen readers after each label (rows share labels)
 * @param {string}   [props.describedBy]  the id of the row's description
 * @param {string[]} props.choices
 * @param {{ api: string }} props.field  for the choice labels (choiceLabelId)
 * @param {*}        [props.hint]
 * @param {string|null} [props.previewHref]
 * @param {string}   [props.className]
 */
function PageChoiceField({
	name,
	htmlName,
	id = name.replaceAll(".", "-"),
	label,
	typeLabel,
	describedBy,
	choices,
	field,
	hint,
	previewHref,
	className,
}) {
	const choice = useWatch({ name });
	const readOnly = useReadOnly();
	return (
		<div className={className}>
			<SelectField
				name={name}
				id={id}
				label={<NamedLabel typeLabel={typeLabel}>{label}</NamedLabel>}
				hint={hint}
				describedBy={describedBy}
				className="mb-0"
			>
				{choices.map((value) => (
					<option key={value} value={value}>
						{intl.formatMessage({ id: choiceLabelId(field, value) })}
					</option>
				))}
			</SelectField>
			{choice === "custom" ? (
				<div className="mt-2 space-y-2">
					<TextField
						name={htmlName}
						id={`${id}-html`}
						label={
							<NamedLabel typeLabel={typeLabel}>
								<T id="landing-pages.html" />
							</NamedLabel>
						}
						hint={<CodeText>{intl.formatMessage({ id: "landing-pages.html.hint" })}</CodeText>}
						describedBy={describedBy}
						as="textarea"
						rows={10}
						controlClassName="font-mono text-xs"
						spellCheck={false}
						placeholder="<!DOCTYPE html>"
						className="mb-0"
					/>
					{readOnly ? null : <UploadButton htmlName={htmlName} />}
				</div>
			) : null}
			{previewHref ? (
				<div className="mt-2">
					<PreviewLink href={previewHref} names={[name, htmlName]} />
				</div>
			) : null}
		</div>
	);
}

export { PageChoiceField, PreviewLink };
