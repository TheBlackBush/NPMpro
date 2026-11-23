import { useEffect, useState } from "react";
import { useWatch } from "react-hook-form";
import {
	AppModal,
	Button,
	DnsCredentialSelect,
	ErrorAlert,
	HasPermission,
	HookForm,
	Loading,
	useAppForm,
} from "src/components";
import { Checkbox } from "src/components/ui/checkbox";
import { useCreateDnsDomains, useDnsCredentials, useDnsProviders, useProviderDomains } from "src/hooks";
import { cn } from "src/lib/utils";
import { intl, T } from "src/locale";
import { displayDomain } from "src/modules/DnsDomainForms";
import EasyModal from "src/modules/easyModal";
import { fetchState, initialSelection } from "src/modules/FetchDomains";
import { CERTIFICATES, MANAGE } from "src/modules/Permissions";
import { sectionAccent } from "src/modules/SectionAccents";
import { showObjectSuccess } from "src/notifications";
import { sectionIcon } from "src/shell/useNavItems";

const accent = sectionAccent("dnsCredentials");
const Icon = sectionIcon("certificates");

/**
 * The Fetch domains window: the zones the provider of a DNS credential lists, the new ones ticked. Adding posts the
 * ticked names with source "fetched" (all or none, like Add domains). A failed fetch never blocks: Cancel closes
 * the window and the domains can be typed.
 */
const showFetchDomainsModal = ({ credentialId } = {}) => {
	EasyModal.show(FetchDomainsModal, { credentialId });
};

function ZoneRow({ zone, checked, onChange }) {
	const id = `fetch-zone-${zone.name}`;
	const label = displayDomain(zone.name);
	return (
		<li className="flex items-center gap-3 px-3 py-2" data-zone-state={zone.state}>
			{zone.state === "here" ? (
				<span className="size-4 shrink-0" aria-hidden="true" />
			) : (
				<Checkbox
					id={id}
					checked={checked}
					disabled={zone.state === "other"}
					onCheckedChange={(value) => onChange(zone.name, value === true)}
				/>
			)}
			<label
				htmlFor={id}
				className={cn("min-w-0 flex-1 wrap-anywhere", zone.state !== "new" && "text-muted-foreground")}
			>
				{label}
			</label>
			<span className="shrink-0 text-sm text-muted-foreground">
				{zone.state === "new" ? <T id="dns-domains.fetch.new" /> : null}
				{zone.state === "here" ? <T id="dns-domains.fetch.here" /> : null}
				{zone.state === "other" ? (
					<T id="dns-domains.fetch.other" data={{ credential: zone.credentialName ?? "" }} />
				) : null}
			</span>
		</li>
	);
}

const FetchDomainsModal = EasyModal.create(({ credentialId, visible, remove }) => {
	const { mutateAsync: createDnsDomains } = useCreateDnsDomains();
	const { data: credentials } = useDnsCredentials();
	const { data: providers } = useDnsProviders();
	const [addError, setAddError] = useState(null);
	const [adding, setAdding] = useState(false);
	const [selected, setSelected] = useState(() => new Set());

	const methods = useAppForm({ defaultValues: { dnsCredentialId: credentialId ?? undefined } });
	const chosenId = useWatch({ control: methods.control, name: "dnsCredentialId" });
	const credential = credentials?.find((c) => c.id === chosenId);
	const { data: answer, error, isFetching } = useProviderDomains(credential ? chosenId : undefined);
	const state = fetchState(isFetching ? undefined : answer, isFetching ? null : error, credential?.provider);
	const loading = Boolean(credential) && (isFetching || state.kind === "loading");

	// a new answer starts with its new zones ticked
	useEffect(() => {
		setSelected(initialSelection(answer?.zones));
	}, [answer]);

	const lists = (c) => providers?.find((p) => p.id === c.provider)?.listsDomains === true;
	const needs = error?.payload?.error?.message_values?.needs;
	const count = selected.size;

	const onToggle = (name, on) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (on) next.add(name);
			else next.delete(name);
			return next;
		});
	};

	const onAdd = async () => {
		setAddError(null);
		setAdding(true);
		try {
			await createDnsDomains({ dnsCredentialId: chosenId, names: [...selected], source: "fetched" });
			showObjectSuccess("dns-domain", "saved");
			remove();
		} catch (err) {
			setAddError(err);
		} finally {
			setAdding(false);
		}
	};

	const kind = loading ? "loading" : credential ? state.kind : "empty";

	return (
		<AppModal show={visible} onHide={adding ? undefined : remove} backdrop="static" data-fetch-domains-window>
			<AppModal.Header closeButton={!adding}>
				<AppModal.Title className="flex items-center gap-2">
					{Icon ? <Icon className={cn("size-5 shrink-0", accent.text)} aria-hidden="true" /> : null}
					{credential ? (
						<T id="dns-domains.fetch.title" data={{ credential: credential.name }} />
					) : (
						<T id="dns-domains.fetch" />
					)}
				</AppModal.Title>
			</AppModal.Header>
			<AppModal.Body data-fetch-domains="" data-fetch-state={kind}>
				<ErrorAlert error={addError} onClose={() => setAddError(null)} />
				<HookForm methods={methods} onSubmit={() => {}}>
					<DnsCredentialSelect name="dnsCredentialId" canUse={lists} />
				</HookForm>
				{loading ? <Loading noLogo /> : null}
				{!loading && credential && state.kind === "error" ? (
					<div className="mt-3">
						<ErrorAlert error={error ?? intl.formatMessage({ id: "dns-domains.fetch.not-supported" })} />
						<p className="mt-2 mb-0 text-sm text-muted-foreground">
							<T id={state.hintId} />
							{needs ? ` ${needs}` : ""}
						</p>
					</div>
				) : null}
				{!loading && credential && state.kind === "empty" ? (
					<p className="mt-3 mb-0 text-muted-foreground">
						<T id="dns-domains.fetch.empty" />
					</p>
				) : null}
				{!loading && credential && state.kind === "list" ? (
					<div className="mt-3">
						{state.truncated ? (
							<p className="mb-2 text-sm text-muted-foreground">
								<T id="dns-domains.fetch.truncated" />
							</p>
						) : null}
						<ul className="m-0 max-h-96 list-none divide-y overflow-y-auto rounded-md border p-0">
							{state.rows.map((zone) => (
								<ZoneRow
									key={zone.name}
									zone={zone}
									checked={selected.has(zone.name)}
									onChange={onToggle}
								/>
							))}
						</ul>
					</div>
				) : null}
			</AppModal.Body>
			<AppModal.Footer>
				<Button variant="ghost" onClick={remove} disabled={adding}>
					<T id="cancel" />
				</Button>
				<HasPermission section={CERTIFICATES} permission={MANAGE} hideError>
					<Button color="primary" isLoading={adding} disabled={adding || count === 0} onClick={onAdd}>
						<T id="dns-domains.fetch.add" data={{ count }} />
					</Button>
				</HasPermission>
			</AppModal.Footer>
		</AppModal>
	);
});

export { showFetchDomainsModal };
