import { useEffect, useMemo, useRef, useState } from "react";
import { useController, useFormContext, useWatch } from "react-hook-form";
import {
	ApiErrorContent,
	AppModal,
	Button,
	ChoiceGroup,
	Combobox,
	DnsCredentialSelect,
	ErrorAlert,
	FormField,
	FormSubmit,
	HasPermission,
	HookForm,
	Loading,
	NoticeAlert,
	PasswordField,
	SelectField,
	SuggestionRow,
	SwitchField,
	TextField,
	useAppForm,
	useFieldError,
	usePendingEntry,
	useReadOnly,
} from "src/components";
import { Input } from "src/components/ui/input";
import {
	DirtyTracker,
	useCanManage,
	useDdnsProviders,
	useDdnsRecord,
	useDnsCredentials,
	useDomainSuggestions,
	useIsAdmin,
	useSetDdnsRecord,
	useUnsavedChangesGuard,
	useUser,
} from "src/hooks";
import { cn } from "src/lib/utils";
import { intl, T } from "src/locale";
import {
	chosenProvider,
	ddnsRecordPayload,
	ddnsRecordValidate,
	ddnsRulesInput,
	IP_VERSIONS,
	isStoppedRecord,
	minTtlOf,
	missingDetailsOf,
	normalizeRecordName,
	providerSwitchReset,
	suggestedZone,
	zoneFor,
} from "src/modules/DdnsForms";
import {
	CREDENTIAL,
	credentiallessChoices,
	isCustom,
	providerFieldsOf,
	providerIdOf,
	providerNoteOf,
	withoutCredential,
} from "src/modules/DdnsProviderRules";
import { challengeSuggestion, suggestionStep } from "src/modules/DnsChallengeSuggestion";
import { displayDomain } from "src/modules/DnsDomainForms";
import { domainSuggestions } from "src/modules/DomainSuggestions";
import EasyModal from "src/modules/easyModal";
import { windowTitleId } from "src/modules/HostForms";
import { CERTIFICATES, MANAGE } from "src/modules/Permissions";
import { sectionAccent } from "src/modules/SectionAccents";
import { showObjectSuccess } from "src/notifications";
import { ddnsErrorText } from "src/pages/Certificates/DynamicDns/errorText";
import { sectionIcon } from "src/shell/useNavItems";

const accent = sectionAccent("dnsCredentials");
const Icon = sectionIcon("certificates");

/**
 * The Add and Edit window of a dynamic DNS record (a View window without manage); no id adds one, with the values
 * of prefill ({ name, credentialId }, see DdnsSuggestions) when given
 */
const showDdnsRecordModal = (id, prefill) => {
	EasyModal.show(DdnsRecordModal, { id, prefill });
};

const emptyRecord = {
	name: "",
	credentialId: undefined,
	zone: "",
	kind: "address",
	target: "",
	ipVersion: "ipv4",
	ipv6Suffix: "",
	ttl: "",
	enabled: true,
	providerId: CREDENTIAL,
	url: "",
	method: "GET",
	expect: "",
	username: "",
	password: "",
	domain: "",
};

// the write-only fields (url, username, password) come back empty: a saved one is told by urlSet and secretSet
const toForm = (record, providers) => ({
	...emptyRecord,
	providerId: providerIdOf(record, providers),
	method: record.method ?? "GET",
	expect: record.expect ?? "",
	domain: record.domain ?? "",
	name: record.name,
	credentialId: record.dnsCredentialId ?? undefined,
	zone: record.zone ?? "",
	kind: record.kind,
	target: record.target ?? "",
	ipVersion: record.ipVersion ?? "ipv4",
	ipv6Suffix: record.ipv6Suffix ?? "",
	ttl: record.ttl === null || record.ttl === undefined ? "" : String(record.ttl),
	enabled: Boolean(record.enabled),
});

const textOf = (problem) => intl.formatMessage({ id: problem.id }, problem.values);

const isRecordName = (text) => normalizeRecordName(text).error === undefined;
const refusedName = (refused) => intl.formatMessage({ id: "error.ddns-name-invalid" }, { name: refused.join(", ") });

// the name: the domain picker, one name; a wildcard is offered only where the provider writes one
function NameField({ wildcards, zones, names }) {
	const { field } = useController({ name: "name" });
	const error = useFieldError("name");
	const readOnly = useReadOnly();
	const pending = usePendingEntry("name", refusedName);
	const [query, setQuery] = useState("");
	const options = useMemo(
		() =>
			domainSuggestions({ query, zones, names, wildcards, isValid: isRecordName }).map((entry) => ({
				...entry,
				groupLabel: intl.formatMessage({ id: entry.groupLabelId }),
			})),
		[query, zones, names, wildcards],
	);
	return (
		<FormField
			id="ddnsName"
			label={<T id="ddns.column.name" />}
			required
			hint={<T id="ddns.name.hint" />}
			error={error}
		>
			{(control) => (
				<Combobox
					{...control}
					ref={field.ref}
					name="name"
					creatable
					filter={false}
					disabled={readOnly}
					isValidNew={isRecordName}
					options={options}
					renderOption={(option) => <SuggestionRow option={option} />}
					value={field.value || null}
					placeholder={intl.formatMessage({ id: "ddns.name.placeholder" })}
					onBlur={field.onBlur}
					commitRef={pending.ref}
					onQueryChange={(text) => {
						setQuery(text);
						pending.setPending(text.trim() !== "");
					}}
					onChange={(value) => field.onChange(value ?? "")}
				/>
			)}
		</FormField>
	);
}

// the credential: only providers with an updater; a new record takes the one whose domains cover the name until the
// user picks one
function CredentialField({ ownerUserId, canUse, zones, credentials, userId, isNew }) {
	const { setValue } = useFormContext();
	const name = useWatch({ name: "name" });
	const credentialId = useWatch({ name: "credentialId" });
	const [handPicked, setHandPicked] = useState(!isNew);
	const applied = useRef(null);
	useEffect(() => {
		const usable = (credentials ?? []).filter(canUse);
		const { preselect } = challengeSuggestion({
			names: name ? [name] : [],
			zones,
			credentials: usable,
			userId,
			credentialId: credentialId ?? null,
			handPicked,
		});
		const offered = preselect && usable.some((c) => c.id === preselect.credentialId) ? preselect : null;
		const current = (credentials ?? []).find((c) => c.id === credentialId);
		const step = suggestionStep({
			preselect: offered,
			providerId: current?.provider ?? null,
			credentialId: credentialId ?? null,
			applied: applied.current,
			handPicked,
		});
		applied.current = step.applied;
		if (step.set) setValue("credentialId", step.set.credentialId, { shouldDirty: false });
		else if (step.clear) setValue("credentialId", undefined, { shouldDirty: false });
	}, [name, credentialId, handPicked, zones, credentials, canUse, userId, setValue]);
	return (
		<DnsCredentialSelect
			name="credentialId"
			ownerUserId={ownerUserId}
			canUse={canUse}
			hint={<T id="ddns.credential.hint" />}
			onUserChange={() => setHandPicked(true)}
		/>
	);
}

// the zone: read only from the match, typed when no domain of the credential covers the name; a save that keeps the
// name and the credential keeps the stored zone, so that one shows
function ZoneField({ zones, credentials, stored }) {
	const name = useWatch({ name: "name" });
	const credentialId = useWatch({ name: "credentialId" });
	const { register } = useFormContext();
	const error = useFieldError("zone");
	const readOnly = useReadOnly();
	const normalized = normalizeRecordName(name ?? "");
	const credential = (credentials ?? []).find((c) => c.id === credentialId);
	if (normalized.error || !credential) return null;
	const kept = stored && normalized.name === stored.name && credentialId === stored.dnsCredentialId;
	const covering = zoneFor(normalized.name, credentialId, zones);
	if (covering !== null) {
		return (
			<FormField
				id="ddnsZone"
				label={<T id="ddns.zone" />}
				hint={<T id="ddns.zone.matched" data={{ credential: credential.name }} />}
			>
				{(control) => (
					<Input {...control} readOnly value={displayDomain(kept && stored.zone ? stored.zone : covering)} />
				)}
			</FormField>
		);
	}
	return (
		<FormField
			id="ddnsZone"
			label={<T id="ddns.zone" />}
			required
			hint={
				error ? undefined : (
					<T
						id="error.ddns-no-zone"
						data={{ domain: displayDomain(suggestedZone(normalized.name)), credential: credential.name }}
					/>
				)
			}
			error={error}
		>
			{(control) => (
				<Input {...control} {...register("zone")} readOnly={readOnly} autoComplete="off" spellCheck={false} />
			)}
		</FormField>
	);
}

function KindField() {
	const { field } = useController({ name: "kind" });
	return (
		<ChoiceGroup
			name="kind"
			legend={<T id="ddns.type" />}
			options={[
				{ value: "address", label: <T id="ddns.kind.address" /> },
				{ value: "alias", label: <T id="ddns.kind.alias" /> },
			]}
			value={field.value}
			inputRef={field.ref}
			onBlur={field.onBlur}
			onChange={field.onChange}
		/>
	);
}

function AddressFields({ ipVersions }) {
	const { field } = useController({ name: "ipVersion" });
	const { setValue } = useFormContext();
	const ipVersion = useWatch({ name: "ipVersion" });
	// the provider takes some IP versions only: a version it does not take gives way to its first
	useEffect(() => {
		if (!ipVersions.includes(ipVersion)) setValue("ipVersion", ipVersions[0], { shouldDirty: false });
	}, [ipVersions, ipVersion, setValue]);
	return (
		<>
			{ipVersions.length > 1 ? (
				<ChoiceGroup
					name="ipVersion"
					legend={<T id="ddns.column.ip-version" />}
					options={ipVersions.map((value) => ({ value, label: IP_VERSIONS[value] }))}
					value={field.value}
					inputRef={field.ref}
					onBlur={field.onBlur}
					onChange={field.onChange}
				/>
			) : null}
			{ipVersion === "ipv4" ? null : (
				<TextField
					name="ipv6Suffix"
					id="ddnsIpv6Suffix"
					label={<T id="ddns.suffix" />}
					hint={<T id="ddns.suffix.hint" />}
					placeholder="::1"
					autoComplete="off"
					spellCheck={false}
				/>
			)}
		</>
	);
}

// the target of an alias: a name, with the domain picker
function TargetField({ zones, names }) {
	const { field } = useController({ name: "target" });
	const error = useFieldError("target");
	const readOnly = useReadOnly();
	const pending = usePendingEntry("target", refusedName);
	const [query, setQuery] = useState("");
	const options = useMemo(
		() =>
			domainSuggestions({ query, zones, names, wildcards: false, isValid: isRecordName }).map((entry) => ({
				...entry,
				groupLabel: intl.formatMessage({ id: entry.groupLabelId }),
			})),
		[query, zones, names],
	);
	return (
		<FormField
			id="ddnsTarget"
			label={<T id="ddns.target" />}
			required
			hint={<T id="ddns.target.hint" />}
			error={error}
		>
			{(control) => (
				<Combobox
					{...control}
					ref={field.ref}
					name="target"
					creatable
					filter={false}
					disabled={readOnly}
					isValidNew={isRecordName}
					options={options}
					renderOption={(option) => <SuggestionRow option={option} />}
					value={field.value || null}
					placeholder={intl.formatMessage({ id: "ddns.name.placeholder" })}
					onBlur={field.onBlur}
					commitRef={pending.ref}
					onQueryChange={(text) => {
						setQuery(text);
						pending.setPending(text.trim() !== "");
					}}
					onChange={(value) => field.onChange(value ?? "")}
				/>
			)}
		</FormField>
	);
}

// the provider: a saved DNS credential, or a service that takes its details in the record; fixed on an edit. The
// custom provider is named to administrators only, who alone can choose it.
function ProviderField({ choices, isNew, isAdmin }) {
	return (
		<SelectField
			name="providerId"
			id="ddnsProvider"
			label={<T id="ddns.provider" />}
			hint={<T id={isAdmin ? "ddns.provider.hint" : "ddns.provider.hint-presets"} />}
			disabled={!isNew}
		>
			<option value={CREDENTIAL}>{intl.formatMessage({ id: "ddns.provider.credential" })}</option>
			{choices.map((choice) => (
				<option key={choice.id} value={choice.id}>
					{choice.label}
				</option>
			))}
		</SelectField>
	);
}

// the account details of a preset and the custom provider's URL: write-only, a saved one stays when left empty. A
// View window asks for nothing: no "leave empty" hint and no required marks.
function AccountFields({ provider, stored }) {
	const readOnly = useReadOnly();
	const shown = providerFieldsOf(provider);
	const stays = provider && isCustom(provider) ? stored?.urlSet === true : stored?.secretSet === true;
	const saved = stays || readOnly;
	const keep = stays && !readOnly ? <T id="ddns.field.saved-keep" /> : undefined;
	const common = { autoComplete: "off", spellCheck: false };
	return (
		<>
			{shown.fields.includes("domain") ? (
				<TextField
					{...common}
					name="domain"
					id="ddnsDomain"
					label={<T id="ddns.field.domain" />}
					hint={<T id="ddns.field.domain.hint" />}
					required={!readOnly}
				/>
			) : null}
			{shown.fields.includes("username") ? (
				<TextField
					{...common}
					name="username"
					id="ddnsUsername"
					label={<T id="ddns.field.username" />}
					hint={keep}
					required={!saved}
				/>
			) : null}
			{shown.fields.includes("password") ? (
				<PasswordField
					{...common}
					name="password"
					id="ddnsPassword"
					autoComplete="new-password"
					label={
						<T id={provider.id === "namecheap" ? "ddns.field.password-namecheap" : "ddns.field.password"} />
					}
					hint={keep}
					required={!saved}
				/>
			) : null}
			{shown.fields.includes("url") ? (
				<PasswordField
					{...common}
					name="url"
					id="ddnsUrl"
					autoComplete="new-password"
					label={<T id="ddns.field.url" />}
					hint={
						<>
							{keep ? <>{keep} </> : null}
							<T id="ddns.field.url.hint" data={{ placeholders: "{ip}, {ipv4}, {ipv6}, {name}" }} />
						</>
					}
					required={!saved}
				/>
			) : null}
			{shown.fields.includes("method") ? (
				<SelectField name="method" id="ddnsMethod" label={<T id="ddns.field.method" />}>
					<option value="GET">GET</option>
					<option value="POST">POST</option>
				</SelectField>
			) : null}
			{shown.fields.includes("expect") ? (
				<TextField
					{...common}
					name="expect"
					id="ddnsExpect"
					label={<T id="ddns.field.expect" />}
					hint={<T id="ddns.field.expect.hint" />}
				/>
			) : null}
		</>
	);
}

function RecordFields({ stored, prefilled, providers, credentials, zones, names, ownerUserId, userId, isAdmin }) {
	const { register } = useFormContext();
	const credentialId = useWatch({ name: "credentialId" });
	const providerId = useWatch({ name: "providerId" });
	const kind = useWatch({ name: "kind" });
	const provider = chosenProvider({ providerId, credentialId }, providers, credentials);
	const own = withoutCredential(providerId);
	const shown = providerFieldsOf(provider);
	const note = providerNoteOf(provider);
	const choices = useMemo(() => credentiallessChoices(providers, isAdmin), [providers, isAdmin]);
	const canUse = useMemo(() => (c) => providers.some((p) => p.credentialProvider === c.provider), [providers]);
	const { setValue } = useFormContext();
	const lastProvider = useRef(providerId);
	// on Add, another provider starts with empty details: one service's password or URL never goes to another (the
	// provider of a saved record cannot change)
	useEffect(() => {
		if (stored || lastProvider.current === providerId) return;
		lastProvider.current = providerId;
		for (const [key, value] of Object.entries(providerSwitchReset())) setValue(key, value, { shouldDirty: false });
	}, [providerId, stored, setValue]);
	return (
		<>
			<NameField wildcards={shown.wildcard} zones={zones.suggestion} names={names} />
			<ProviderField choices={choices} isNew={!stored} isAdmin={isAdmin} />
			{own ? (
				<AccountFields provider={provider} stored={stored} />
			) : (
				<>
					<CredentialField
						ownerUserId={ownerUserId}
						canUse={canUse}
						zones={zones.suggestion}
						credentials={credentials}
						userId={userId}
						// a credential a suggestion filled in stays chosen: the automatic pick only fills an empty one
						isNew={!(stored || prefilled)}
					/>
					{shown.zone ? <ZoneField zones={zones.match} credentials={credentials} stored={stored} /> : null}
				</>
			)}
			{note ? (
				<NoticeAlert variant="info" className="mb-3">
					<T id={note.id} data={note.values} />
				</NoticeAlert>
			) : null}
			{shown.alias ? <KindField /> : null}
			{kind === "alias" && shown.alias ? (
				<TargetField zones={zones.suggestion} names={names} />
			) : (
				<AddressFields ipVersions={shown.ipVersions} />
			)}
			{shown.ttl ? (
				<TextField
					name="ttl"
					id="ddnsTtl"
					label={<T id="ddns.ttl" />}
					hint={
						provider ? (
							<T id="ddns.ttl.hint-min" data={{ min: minTtlOf(provider), provider: provider.label }} />
						) : (
							<T id="ddns.ttl.hint" />
						)
					}
					inputMode="numeric"
					autoComplete="off"
					placeholder={intl.formatMessage({ id: "ddns.ttl.placeholder" })}
				/>
			) : null}
			<SwitchField
				id="ddnsEnabled"
				label={<T id="ddns.enabled" />}
				hint={<T id="ddns.enabled.hint" />}
				{...register("enabled")}
			/>
		</>
	);
}

// what a user who may not manage custom records sees of one: the name and the state, never its details
function CustomRecordRow({ stored, label }) {
	return (
		<>
			<TextField name="name" id="ddnsName" label={<T id="ddns.column.name" />} readOnly />
			<FormField id="ddnsProvider" label={<T id="ddns.provider" />}>
				{(control) => <Input {...control} readOnly value={label} />}
			</FormField>
			<NoticeAlert variant="info" className="mb-3">
				<T id="ddns.custom.hidden" data={{ name: stored.name }} />
			</NoticeAlert>
		</>
	);
}

const DdnsRecordModal = EasyModal.create(({ id, prefill, visible, remove }) => {
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	const readOnly = !useCanManage(CERTIFICATES);
	const isNew = id === undefined || id === null;
	const {
		data: stored,
		isPending,
		error,
	} = useDdnsRecord(isNew ? undefined : id, undefined, {
		refetchOnMount: "always",
	});
	const { data: providers, isPending: providersPending } = useDdnsProviders();
	const { data: credentials } = useDnsCredentials();
	const { data: suggested } = useDomainSuggestions();
	const { data: me } = useUser("me");
	const isAdmin = useIsAdmin();
	const { mutateAsync: setRecord } = useSetDdnsRecord();
	const [errorMsg, setErrorMsg] = useState(null);

	const zones = useMemo(
		() => ({
			suggestion: suggested?.zones ?? [],
			match: (suggested?.zones ?? []).map((zone) => ({
				name: zone.name,
				credentialId: zone.dnsCredentialId,
				ownerUserId: zone.ownerUserId,
			})),
		}),
		[suggested],
	);
	const ready = providers && isAdmin !== undefined && (isNew || stored);
	// a custom record belongs to the administrators: anyone else sees its row and no details
	const customHidden = !isNew && stored?.provider === "custom" && isAdmin === false;
	const viewOnly = readOnly || customHidden;
	const stoppedError = !customHidden && isStoppedRecord(stored) ? ddnsErrorText(stored) : null;
	const methods = useAppForm({
		defaultValues: emptyRecord,
		values: ready ? (isNew ? { ...emptyRecord, ...prefill } : toForm(stored, providers)) : undefined,
		validate: (values) => {
			const found = ddnsRecordValidate(ddnsRulesInput(values, chosenProvider(values, providers, credentials)), {
				providers,
				credentials,
				zones: zones.match,
				stored: stored ?? null,
			});
			return Object.fromEntries(Object.entries(found).map(([field, problem]) => [field, textOf(problem)]));
		},
	});
	const { isSubmitting } = methods.formState;

	const onSubmit = async (values) => {
		setErrorMsg(null);
		const normalized = normalizeRecordName(values.name);
		const covering = normalized.error ? null : zoneFor(normalized.name, values.credentialId, zones.match);
		try {
			await setRecord(
				ddnsRecordPayload(values, stored, covering === null, chosenProvider(values, providers, credentials)),
			);
			showObjectSuccess("ddns-record", "saved");
			remove();
		} catch (err) {
			setErrorMsg(<ApiErrorContent error={err} />);
		}
	};

	return (
		<AppModal show={visible} onHide={isSubmitting ? undefined : close} backdrop="static" data-ddns-record-window>
			{error && <ErrorAlert error={error} className="m-3" />}
			{(isPending && !isNew) || providersPending ? <Loading noLogo /> : null}
			{ready && (
				<HookForm readOnly={viewOnly} methods={methods} onSubmit={onSubmit}>
					<DirtyTracker dirtyRef={dirtyRef} />
					<AppModal.Header closeButton={!isSubmitting}>
						<AppModal.Title className="flex items-center gap-2">
							{Icon ? <Icon className={cn("size-5 shrink-0", accent.text)} aria-hidden="true" /> : null}
							<T
								id={windowTitleId({ editing: !isNew, readOnly: viewOnly })}
								tData={{ object: "ddns-record" }}
							/>
						</AppModal.Title>
					</AppModal.Header>
					<AppModal.Body>
						<ErrorAlert onClose={() => setErrorMsg(null)}>{errorMsg}</ErrorAlert>
						{/* a restore without secrets: the record asks for its URL or password again */}
						{!customHidden && missingDetailsOf(stored) ? (
							<NoticeAlert variant="warning" className="mb-3">
								<T id={missingDetailsOf(stored)} />
							</NoticeAlert>
						) : null}
						{/* a provider refused the account: the error, and that no automatic try comes until the user acts */}
						{!customHidden && isStoppedRecord(stored) ? (
							<NoticeAlert variant="warning" className="mb-3">
								{stoppedError ? <span className="block">{stoppedError}</span> : null}
								<T id="ddns.state.stopped" />
							</NoticeAlert>
						) : null}
						{/* a View window: the fields sit in a disabled fieldset */}
						<fieldset disabled={viewOnly} className="m-0 min-w-0 border-0 p-0">
							{customHidden ? (
								<CustomRecordRow
									stored={stored}
									label={
										providers.find((entry) => entry.id === "custom")?.label ??
										intl.formatMessage({ id: "ddns.provider.custom" })
									}
								/>
							) : (
								<RecordFields
									isAdmin={isAdmin}
									stored={stored}
									prefilled={prefill?.credentialId !== undefined}
									providers={providers}
									credentials={credentials}
									zones={zones}
									names={suggested?.names ?? []}
									ownerUserId={isNew ? me?.id : stored.ownerUserId}
									userId={me?.id}
								/>
							)}
						</fieldset>
					</AppModal.Body>
					<AppModal.Footer>
						<Button variant="ghost" onClick={close} disabled={isSubmitting}>
							<T id={viewOnly ? "action.close" : "cancel"} />
						</Button>
						{customHidden ? null : (
							<HasPermission section={CERTIFICATES} permission={MANAGE} hideError>
								<FormSubmit edit={!isNew} isLoading={isSubmitting} disabled={isSubmitting}>
									<T id="save" />
								</FormSubmit>
							</HasPermission>
						)}
					</AppModal.Footer>
				</HookForm>
			)}
		</AppModal>
	);
});

export { showDdnsRecordModal };
