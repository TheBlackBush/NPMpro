import { useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import {
	ApiErrorContent,
	ErrorAlert,
	HookForm,
	PageChoiceField,
	SelectField,
	TextField,
	useAppForm,
	useResetToSaved,
} from "src/components";
import { PreviewLink } from "src/components/Form/PageChoiceField";
import { useIsAdmin, useLandingPages, useSaveLandingPages } from "src/hooks";
import { intl, T } from "src/locale";
import {
	DEFAULT_PAGE,
	landingPayload,
	landingValidate,
	landingValues,
	PAGE_TYPES,
	previewPath,
} from "src/modules/LandingPageForms";
import { DEFAULT_SITE_OPTIONS, defaultSiteHiddenFields } from "src/modules/SettingsForms";
import { validations } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";
import { SaveBar } from "./SaveBar";
import { SettingsCard } from "./SettingsCard";
import { SettingsForm } from "./SettingsForm";
import { SettingsHeading } from "./SettingsHeading";

const validate = landingValidate(validations);
const GLOBAL_CHOICES = ["npmpro", "custom"];
// the Default page's previews: its NPMpro page, the global 404 page, its custom HTML
const DEFAULT_PREVIEW = { congratulations: "default_site", 404: "not_found", html: "default_site" };

function Row({ page, id, hideTitle = false, children }) {
	return (
		<div className="border-b pb-4 last:border-b-0 last:pb-0">
			<div className="min-w-0 space-y-1">
				{hideTitle ? null : (
					<p className="text-sm font-medium">
						<T id={page.labelId} />
					</p>
				)}
				<p id={`${id}-description`} className="mb-2 text-sm text-muted-foreground">
					<T id={`${page.labelId}.description`} />
				</p>
				{children}
			</div>
		</div>
	);
}

function DefaultPageRow({ isAdmin }) {
	const { clearErrors } = useFormContext();
	const value = useWatch({ name: "defaultSite.value" });
	const source = value === "404" || value === "html" ? "global" : "npmpro";
	return (
		<Row page={DEFAULT_PAGE} id="landing-default" hideTitle>
			<SelectField
				name="defaultSite.value"
				id="landing-default-site"
				label={<T id="landing-pages.default-site.answer" />}
				describedBy="landing-default-description"
				className="mb-0"
				registerOptions={{
					onChange: (event) =>
						clearErrors(defaultSiteHiddenFields(event.target.value).map((name) => `defaultSite.${name}`)),
				}}
			>
				{DEFAULT_SITE_OPTIONS.map((option) => (
					<option key={option} value={option}>
						{intl.formatMessage({ id: `settings.default-site.${option}` })}
					</option>
				))}
			</SelectField>
			{value === "redirect" ? (
				<TextField
					name="defaultSite.redirect"
					id="landing-default-redirect"
					label={<T id="settings.default-site.redirect" />}
					placeholder="https://"
					autoComplete="off"
				/>
			) : null}
			{value === "html" ? (
				<>
					<TextField
						name="defaultSite.html"
						id="landing-default-html"
						label={<T id="settings.default-site.html" />}
						as="textarea"
						rows={10}
						controlClassName="font-mono text-xs"
						spellCheck={false}
					/>
					<TextField
						name="defaultSite.status"
						id="landing-default-status"
						label={<T id="settings.default-site.status" />}
						type="number"
						min={400}
						max={599}
						placeholder="200"
						autoComplete="off"
					/>
				</>
			) : null}
			{isAdmin && DEFAULT_PREVIEW[value] ? (
				<PreviewLink
					href={previewPath({ source, type: DEFAULT_PREVIEW[value] })}
					names={["defaultSite.value", "defaultSite.html"]}
				/>
			) : null}
		</Row>
	);
}

function LandingPagesForm({ data }) {
	const isAdmin = useIsAdmin();
	const { mutateAsync: save } = useSaveLandingPages();
	const [errorMsg, setErrorMsg] = useState(null);
	const [defaultValues] = useState(() => landingValues(data));
	const methods = useAppForm({ defaultValues, validate });
	const resetToSaved = useResetToSaved(methods);

	const onSubmit = async (values) => {
		setErrorMsg(null);
		try {
			await save(landingPayload(values, methods.formState.defaultValues));
			resetToSaved();
			showObjectSuccess("setting", "saved");
		} catch (err) {
			setErrorMsg(<ApiErrorContent error={err} />);
		}
	};

	return (
		<HookForm methods={methods} onSubmit={onSubmit} className="space-y-4">
			<SettingsHeading titleId="settings.landing-pages" />
			<ErrorAlert onClose={() => setErrorMsg(null)}>{errorMsg}</ErrorAlert>
			<SettingsCard title={<T id="landing-pages.default-site" />}>
				<DefaultPageRow isAdmin={isAdmin} />
			</SettingsCard>
			<SettingsCard
				title={<T id="landing-pages.global" />}
				description={<T id="landing-pages.global.description" />}
			>
				{PAGE_TYPES.map((page) => (
					<Row key={page.key} page={page} id={`landing-${page.key}`}>
						<PageChoiceField
							name={`pages.${page.key}.choice`}
							htmlName={`pages.${page.key}.html`}
							id={`landing-${page.key}`}
							label={<T id="landing-pages.page" />}
							typeLabel={<T id={page.labelId} />}
							describedBy={`landing-${page.key}-description`}
							choices={GLOBAL_CHOICES}
							field={page}
							previewHref={isAdmin ? previewPath({ source: "global", type: page.api }) : null}
						/>
					</Row>
				))}
			</SettingsCard>
			<SaveBar />
		</HookForm>
	);
}

export default function LandingPages() {
	const { data, isPending, error } = useLandingPages();
	return (
		<SettingsForm titleId="settings.landing-pages" error={error} isPending={isPending}>
			{() => <LandingPagesForm data={data} />}
		</SettingsForm>
	);
}
