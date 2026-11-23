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
	SuggestionRow,
	SwitchField,
	TextField,
	useAppForm,
	useFieldError,
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
	useSetDdnsRecord,
	useUnsavedChangesGuard,
	useUser,
} from "src/hooks";
import { cn } from "src/lib/utils";
import { intl, T } from "src/locale";
import {
	ddnsRecordValidate,
	IP_VERSIONS,
	normalizeRecordName,
	providerOf,
	suggestedZone,
	zoneFor,
} from "src/modules/DdnsForms";
import { challengeSuggestion, suggestionStep } from "src/modules/DnsChallengeSuggestion";
import { displayDomain } from "src/modules/DnsDomainForms";
import { domainSuggestions } from "src/modules/DomainSuggestions";
import EasyModal from "src/modules/easyModal";
import { windowTitleId } from "src/modules/HostForms";
import { CERTIFICATES, MANAGE } from "src/modules/Permissions";
import { sectionAccent } from "src/modules/SectionAccents";
import { showObjectSuccess } from "src/notifications";
import { sectionIcon } from "src/shell/useNavItems";

const accent = sectionAccent("dnsCredentials");
const Icon = sectionIcon("certificates");

/** The Add and Edit window of a dynamic DNS record (a View window without manage); no id adds one */
const showDdnsRecordModal = (id) => {
	EasyModal.show(DdnsRecordModal, { id });
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
};

const toForm = (record) => ({
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

// what the rules of DdnsForms see: a field the form hides never blocks a save (an address has no target, an alias no
// IP version or suffix, IPv4 no suffix)
const rulesInput = (values, stored) => {
	if (values.kind === "alias") {
		const keeps = stored?.kind === "alias";
		return { ...values, ipVersion: keeps ? values.ipVersion : undefined, ipv6Suffix: "" };
	}
	return { ...values, target: "", ipv6Suffix: values.ipVersion === "ipv4" ? "" : values.ipv6Suffix };
};

// the request: an alias sends its target only, an address its IP version and suffix only
const toPayload = (values, stored, zoneTyped) => {
	const ttl = String(values.ttl ?? "").trim();
	const payload = {
		id: stored?.id,
		name: values.name.trim(),
		dnsCredentialId: values.credentialId,
		kind: values.kind,
		enabled: values.enabled,
	};
	if (ttl !== "") payload.ttl = Number(ttl);
	else if (stored) payload.ttl = null;
	if (zoneTyped && values.zone.trim() !== "") payload.zone = values.zone.trim();
	if (values.kind === "alias") {
		payload.target = values.target.trim();
		return payload;
	}
	payload.ipVersion = values.ipVersion;
	const suffix = String(values.ipv6Suffix ?? "").trim();
	if (values.ipVersion !== "ipv4" && suffix !== "") payload.ipv6Suffix = suffix;
	else if (stored) payload.ipv6Suffix = null;
	return payload;
};

const isRecordName = (text) => normalizeRecordName(text).error === undefined;

// the name: the domain picker, one name; a wildcard is offered only where the provider writes one
function NameField({ wildcards, zones, names }) {
	const { field } = useController({ name: "name" });
	const error = useFieldError("name");
	const readOnly = useReadOnly();
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
					onQueryChange={setQuery}
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
		if (step.set) setValue("credentialId", step.set.credentialId, { shouldDirty: true });
		else if (step.clear) setValue("credentialId", undefined, { shouldDirty: true });
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

// the zone: read only from the match, typed when no domain of the credential covers the name
function ZoneField({ zones, credentials }) {
	const name = useWatch({ name: "name" });
	const credentialId = useWatch({ name: "credentialId" });
	const { register } = useFormContext();
	const error = useFieldError("zone");
	const readOnly = useReadOnly();
	const normalized = normalizeRecordName(name ?? "");
	const credential = (credentials ?? []).find((c) => c.id === credentialId);
	if (normalized.error || !credential) return null;
	const covering = zoneFor(normalized.name, credentialId, zones);
	if (covering !== null) {
		return (
			<FormField
				id="ddnsZone"
				label={<T id="ddns.zone" />}
				hint={<T id="ddns.zone.matched" data={{ credential: credential.name }} />}
			>
				{(control) => <Input {...control} readOnly value={displayDomain(covering)} />}
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

function AddressFields() {
	const { field } = useController({ name: "ipVersion" });
	const ipVersion = useWatch({ name: "ipVersion" });
	return (
		<>
			<ChoiceGroup
				name="ipVersion"
				legend={<T id="ddns.column.ip-version" />}
				options={[
					{ value: "ipv4", label: IP_VERSIONS.ipv4 },
					{ value: "ipv6", label: IP_VERSIONS.ipv6 },
					{ value: "both", label: IP_VERSIONS.both },
				]}
				value={field.value}
				inputRef={field.ref}
				onBlur={field.onBlur}
				onChange={field.onChange}
			/>
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
					onQueryChange={setQuery}
					onChange={(value) => field.onChange(value ?? "")}
				/>
			)}
		</FormField>
	);
}

function RecordFields({ stored, providers, credentials, zones, names, ownerUserId, userId }) {
	const { register } = useFormContext();
	const credentialId = useWatch({ name: "credentialId" });
	const kind = useWatch({ name: "kind" });
	const credential = (credentials ?? []).find((c) => c.id === credentialId);
	const provider = providerOf(credential, providers);
	const canUse = useMemo(() => (c) => providers.some((p) => p.credentialProvider === c.provider), [providers]);
	return (
		<>
			<NameField wildcards={Boolean(provider?.wildcards)} zones={zones.suggestion} names={names} />
			<CredentialField
				ownerUserId={ownerUserId}
				canUse={canUse}
				zones={zones.suggestion}
				credentials={credentials}
				userId={userId}
				isNew={!stored}
			/>
			<ZoneField zones={zones.match} credentials={credentials} />
			<KindField />
			{kind === "alias" ? <TargetField zones={zones.suggestion} names={names} /> : <AddressFields />}
			<TextField
				name="ttl"
				id="ddnsTtl"
				label={<T id="ddns.ttl" />}
				hint={<T id="ddns.ttl.hint" />}
				inputMode="numeric"
				autoComplete="off"
				placeholder={intl.formatMessage({ id: "ddns.ttl.placeholder" })}
			/>
			<SwitchField
				id="ddnsEnabled"
				label={<T id="ddns.enabled" />}
				hint={<T id="ddns.enabled.hint" />}
				{...register("enabled")}
			/>
		</>
	);
}

const DdnsRecordModal = EasyModal.create(({ id, visible, remove }) => {
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
	const ready = providers && (isNew || stored);
	const methods = useAppForm({
		defaultValues: emptyRecord,
		values: ready ? (isNew ? emptyRecord : toForm(stored)) : undefined,
		validate: (values) => {
			const found = ddnsRecordValidate(rulesInput(values, stored), {
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
			await setRecord(toPayload(values, stored, covering === null));
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
				<HookForm readOnly={readOnly} methods={methods} onSubmit={onSubmit}>
					<DirtyTracker dirtyRef={dirtyRef} />
					<AppModal.Header closeButton={!isSubmitting}>
						<AppModal.Title className="flex items-center gap-2">
							{Icon ? <Icon className={cn("size-5 shrink-0", accent.text)} aria-hidden="true" /> : null}
							<T id={windowTitleId({ editing: !isNew, readOnly })} tData={{ object: "ddns-record" }} />
						</AppModal.Title>
					</AppModal.Header>
					<AppModal.Body>
						<ErrorAlert onClose={() => setErrorMsg(null)}>{errorMsg}</ErrorAlert>
						{/* a View window: the fields sit in a disabled fieldset */}
						<fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0">
							<RecordFields
								stored={stored}
								providers={providers}
								credentials={credentials}
								zones={zones}
								names={suggested?.names ?? []}
								ownerUserId={isNew ? me?.id : stored.ownerUserId}
								userId={me?.id}
							/>
						</fieldset>
					</AppModal.Body>
					<AppModal.Footer>
						<Button variant="ghost" onClick={close} disabled={isSubmitting}>
							<T id={readOnly ? "action.close" : "cancel"} />
						</Button>
						<HasPermission section={CERTIFICATES} permission={MANAGE} hideError>
							<FormSubmit edit={!isNew} isLoading={isSubmitting} disabled={isSubmitting}>
								<T id="save" />
							</FormSubmit>
						</HasPermission>
					</AppModal.Footer>
				</HookForm>
			)}
		</AppModal>
	);
});

export { showDdnsRecordModal };
