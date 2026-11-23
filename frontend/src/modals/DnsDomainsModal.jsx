import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useWatch } from "react-hook-form";
import {
	ApiErrorContent,
	AppModal,
	Button,
	DnsCredentialSelect,
	DnsDomainNamesField,
	ErrorAlert,
	FormSubmit,
	HasPermission,
	HookForm,
	Loading,
	useAppForm,
} from "src/components";
import { Checkbox } from "src/components/ui/checkbox";
import {
	DirtyTracker,
	useCanManage,
	useCreateDnsDomains,
	useDnsCredentials,
	useDnsDomains,
	useDnsProviders,
	useProviderDomains,
	useUnsavedChangesGuard,
} from "src/hooks";
import { cn } from "src/lib/utils";
import { intl, T } from "src/locale";
import { displayDomain, dnsDomainNamesRule, takenNames } from "src/modules/DnsDomainForms";
import EasyModal from "src/modules/easyModal";
import { fetchState, hintIdOf, initialSelection, saveBody } from "src/modules/FetchDomains";
import { fieldsValidate } from "src/modules/HookForm";
import { CERTIFICATES, MANAGE } from "src/modules/Permissions";
import { sectionAccent } from "src/modules/SectionAccents";
import { validations } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";
import { sectionIcon } from "src/shell/useNavItems";

const accent = sectionAccent("dnsCredentials");
const Icon = sectionIcon("certificates");
const EXPAND = ["credential"];

/**
 * The Add domains window: one credential and the names it manages (the backend adds all or none). Opened from the
 * Domains tab, or from a credential (credentialId preset). Typed names work for every provider; when the provider
 * lists zones, they load below the field and the new ones are ticked. Save sends the typed names and the ticked
 * zones in one request. A failed list never blocks typing or saving.
 */
const showDnsDomainsModal = ({ credentialId } = {}) => {
	EasyModal.show(DnsDomainsModal, { credentialId });
};

// the owner of the chosen credential: the names are checked against what that owner keeps elsewhere
function DomainNames({ credentials }) {
	const credentialId = useWatch({ name: "dnsCredentialId" });
	const ownerUserId = credentials?.find((c) => c.id === credentialId)?.ownerUserId;
	return <DnsDomainNamesField credentialId={credentialId ?? null} ownerUserId={ownerUserId} />;
}

function ZoneRow({ zone, checked, onChange }) {
	const id = `fetch-zone-${zone.name}`;
	const stateId = `fetch-zone-state-${zone.name}`;
	const here = zone.state === "here";
	return (
		<li className="flex items-center gap-3 px-3 py-2" data-zone-state={zone.state}>
			{here ? (
				<span className="size-4 shrink-0" aria-hidden="true" />
			) : (
				<Checkbox
					id={id}
					checked={checked}
					disabled={zone.state === "other"}
					aria-describedby={stateId}
					onCheckedChange={(value) => onChange(zone.name, value === true)}
				/>
			)}
			{/* a row that is already here has no checkbox for its label */}
			<label
				htmlFor={here ? undefined : id}
				className={cn("min-w-0 flex-1 wrap-anywhere", zone.state !== "new" && "text-muted-foreground")}
			>
				{displayDomain(zone.name)}
			</label>
			<span id={stateId} className="shrink-0 text-sm text-muted-foreground">
				{zone.state === "new" ? <T id="dns-domains.fetch.new" /> : null}
				{zone.state === "here" ? <T id="dns-domains.fetch.here" /> : null}
				{zone.state === "other" ? (
					<T id="dns-domains.fetch.other" data={{ credential: zone.credentialName ?? "" }} />
				) : null}
			</span>
		</li>
	);
}

// the zones the provider of the chosen credential lists, below the typed names
function ProviderZones({ credential, kind, state, loading, error, selected, onToggle }) {
	const needs = error?.payload?.error?.message_values?.needs;
	return (
		<section className="mt-3" data-fetch-domains="" data-fetch-state={kind}>
			<h3 className="mb-2 text-sm font-medium">
				<T id="dns-domains.fetch.title" data={{ credential: credential.name }} />
			</h3>
			{loading ? <Loading noLogo /> : null}
			{!loading && state.kind === "error" ? (
				<div>
					<ErrorAlert error={error} />
					{/* the permission hint only for a refused credential */}
					{state.hintId ? (
						<p className="mt-2 mb-0 text-sm text-muted-foreground">
							<T id={state.hintId} />
							{/* the provider's own wording only with the general hint (a named hint says it) */}
							{needs && state.hintId === hintIdOf() ? ` ${needs}` : ""}
						</p>
					) : null}
				</div>
			) : null}
			{!loading && state.kind === "empty" ? (
				<p className="mb-0 text-muted-foreground">
					<T id="dns-domains.fetch.empty" />
				</p>
			) : null}
			{!loading && state.kind === "list" ? (
				<>
					{state.truncated ? (
						<p className="mb-2 text-sm text-muted-foreground">
							<T id="dns-domains.fetch.truncated" />
						</p>
					) : null}
					<ul
						aria-label={intl.formatMessage(
							{ id: "dns-domains.fetch.title" },
							{ credential: credential.name },
						)}
						className="m-0 max-h-72 list-none divide-y overflow-y-auto rounded-md border p-0"
					>
						{state.rows.map((zone) => (
							<ZoneRow
								key={zone.name}
								zone={zone}
								checked={selected.has(zone.name)}
								onChange={onToggle}
							/>
						))}
					</ul>
				</>
			) : null}
		</section>
	);
}

const DnsDomainsModal = EasyModal.create(({ credentialId, visible, remove }) => {
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	const { mutateAsync: createDnsDomains } = useCreateDnsDomains();
	const { data: credentials } = useDnsCredentials();
	const { data: domains } = useDnsDomains(EXPAND, { refetchOnMount: "always" });
	const readOnly = !useCanManage(CERTIFICATES);
	const { data: providers } = useDnsProviders();
	const queryClient = useQueryClient();
	const [errorMsg, setErrorMsg] = useState(null);
	const [selected, setSelected] = useState(() => new Set());
	// the validation reads the count of ticked zones at submit time
	const tickedRef = useRef(0);

	const methods = useAppForm({
		defaultValues: { dnsCredentialId: credentialId ?? undefined, domains: [] },
		validate: fieldsValidate((values) => {
			const ownerUserId = credentials?.find((c) => c.id === values.dnsCredentialId)?.ownerUserId;
			const taken = takenNames(values.domains, {
				credentialId: values.dnsCredentialId ?? null,
				ownerUserId,
				domains,
			});
			const namesRule = dnsDomainNamesRule(validations, taken);
			return {
				dnsCredentialId: validations.validateRequired(),
				// the typed names may be empty when a zone is ticked
				domains: (value) =>
					tickedRef.current > 0 && !value?.length
						? undefined
						: (validations.validateRequired()(value) ?? namesRule(value)),
			};
		}),
	});
	const { isSubmitting } = methods.formState;
	const chosenId = useWatch({ control: methods.control, name: "dnsCredentialId" });
	const typed = useWatch({ control: methods.control, name: "domains" });
	const credential = credentials?.find((c) => c.id === chosenId);
	const lists = Boolean(credential) && providers?.find((p) => p.id === credential.provider)?.listsDomains === true;
	const { data: answer, error, isFetching } = useProviderDomains(lists ? chosenId : undefined);
	const state = fetchState(answer, error, credential?.provider);
	// a background refetch keeps the list that is shown; only a first load shows the spinner
	const loading = lists && isFetching && !answer && !error;
	tickedRef.current = selected.size;

	// a new answer starts with its new zones ticked; a changed credential has none until its answer arrives
	useEffect(() => {
		setSelected(initialSelection(answer?.zones));
	}, [answer]);
	// a fetch in flight is aborted when the credential changes and when the window closes
	useEffect(() => {
		const queryKey = ["dns-provider-domains", chosenId];
		return () => void queryClient.cancelQueries({ queryKey });
	}, [chosenId, queryClient]);

	const onToggle = (name, on) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (on) next.add(name);
			else next.delete(name);
			return next;
		});
	};

	const onSubmit = async (values) => {
		setErrorMsg(null);
		try {
			await createDnsDomains(saveBody(values.dnsCredentialId, values.domains, selected));
			showObjectSuccess("dns-domain", "saved");
			remove();
		} catch (err) {
			setErrorMsg(<ApiErrorContent error={err} />);
		}
	};

	return (
		<AppModal show={visible} onHide={isSubmitting ? undefined : close} backdrop="static" data-dns-domains-window>
			<HookForm readOnly={readOnly} methods={methods} onSubmit={onSubmit}>
				<DirtyTracker dirtyRef={dirtyRef} />
				<AppModal.Header closeButton={!isSubmitting}>
					<AppModal.Title className="flex items-center gap-2">
						{Icon ? <Icon className={cn("size-5 shrink-0", accent.text)} aria-hidden="true" /> : null}
						<T id="dns-domains.add" />
					</AppModal.Title>
				</AppModal.Header>
				<AppModal.Body>
					<ErrorAlert onClose={() => setErrorMsg(null)}>{errorMsg}</ErrorAlert>
					<fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0">
						<DnsCredentialSelect name="dnsCredentialId" />
						<DomainNames credentials={credentials} />
						{lists ? (
							<ProviderZones
								credential={credential}
								kind={loading ? "loading" : state.kind}
								state={state}
								loading={loading}
								error={error}
								selected={selected}
								onToggle={onToggle}
							/>
						) : null}
					</fieldset>
				</AppModal.Body>
				<AppModal.Footer>
					<Button variant="ghost" onClick={close} disabled={isSubmitting}>
						<T id="cancel" />
					</Button>
					<HasPermission section={CERTIFICATES} permission={MANAGE} hideError>
						<FormSubmit
							isLoading={isSubmitting}
							disabled={isSubmitting || (typed?.length ?? 0) + selected.size === 0}
						>
							<T id="save" />
						</FormSubmit>
					</HasPermission>
				</AppModal.Footer>
			</HookForm>
		</AppModal>
	);
});

export { showDnsDomainsModal };
