import { useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import {
	ApiErrorContent,
	ErrorAlert,
	HookForm,
	PageChoiceField,
	PageEditor,
	PageLine,
	PreviewLink,
	SelectField,
	TextField,
	useAppForm,
	useResetToSaved,
	useSavedValue,
} from "src/components";
import { useIsAdmin, useLandingPages, useSaveLandingPages } from "src/hooks";
import { intl, T } from "src/locale";
import {
	DEFAULT_PAGE,
	defaultSitePreview,
	landingPayload,
	landingValidate,
	landingValues,
	PAGE_GROUPS,
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
import { SettingsLead } from "./SettingsLead";

const validate = landingValidate(validations);
const GLOBAL_CHOICES = ["npmpro", "custom"];

function DefaultPageRow({ isAdmin }) {
	const { clearErrors } = useFormContext();
	const value = useWatch({ name: "defaultSite.value" });
	// the preview shows the saved default page, so the saved value decides whether there is one
	const previewHref = defaultSitePreview(useSavedValue("defaultSite.value"));
	const title = <T id={DEFAULT_PAGE.labelId} />;
	const extra = value === "redirect" || value === "html";
	return (
		<PageLine
			id="landing-default"
			title={title}
			hint={<T id={`${DEFAULT_PAGE.labelId}.description`} />}
			control={
				<SelectField
					name="defaultSite.value"
					id="landing-default-site"
					label={<span className="sr-only">{title}</span>}
					describedBy="landing-default-description"
					className="mb-0 gap-0"
					registerOptions={{
						onChange: (event) =>
							clearErrors(
								defaultSiteHiddenFields(event.target.value).map((name) => `defaultSite.${name}`),
							),
					}}
				>
					{DEFAULT_SITE_OPTIONS.map((option) => (
						<option key={option} value={option}>
							{intl.formatMessage({ id: `settings.default-site.${option}` })}
						</option>
					))}
				</SelectField>
			}
			preview={
				isAdmin && previewHref ? (
					<PreviewLink href={previewHref} names={["defaultSite.value", "defaultSite.html"]} title={title} />
				) : null
			}
			editor={
				extra ? (
					<PageEditor>
						{value === "redirect" ? (
							<TextField
								name="defaultSite.redirect"
								id="landing-default-redirect"
								label={<T id="settings.default-site.redirect" />}
								placeholder="https://"
								autoComplete="off"
								controlClassName="bg-background"
								className="mb-0"
							/>
						) : (
							<>
								<TextField
									name="defaultSite.html"
									id="landing-default-html"
									label={<T id="settings.default-site.html" />}
									as="textarea"
									rows={8}
									controlClassName="bg-background font-mono text-xs"
									spellCheck={false}
									className="mb-0"
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
									controlClassName="bg-background"
									className="mb-0"
								/>
							</>
						)}
					</PageEditor>
				) : null
			}
		/>
	);
}

function PageGroup({ labelId, infoId, children }) {
	return (
		<SettingsCard title={<T id={labelId} />} info={<T id={infoId} />} lines>
			{children}
		</SettingsCard>
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
			<SettingsLead id="landing-pages.lead" />
			<ErrorAlert onClose={() => setErrorMsg(null)}>{errorMsg}</ErrorAlert>
			<PageGroup labelId="landing-pages.group.default" infoId="landing-pages.group.default.description">
				<DefaultPageRow isAdmin={isAdmin} />
			</PageGroup>
			{PAGE_GROUPS.map((group) => (
				<PageGroup
					key={group.id}
					labelId={group.labelId}
					infoId={`landing-pages.group.${group.id}.description`}
				>
					{group.keys.map((key) => {
						const page = PAGE_TYPES.find((type) => type.key === key);
						return (
							<PageChoiceField
								key={key}
								name={`pages.${key}.choice`}
								htmlName={`pages.${key}.html`}
								id={`landing-${key}`}
								title={<T id={page.labelId} />}
								codes={page.codes}
								hint={<T id={`${page.labelId}.description`} />}
								choices={GLOBAL_CHOICES}
								field={page}
								previewHref={isAdmin ? previewPath({ source: "global", type: page.api }) : null}
							/>
						);
					})}
				</PageGroup>
			))}
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
