import { TriangleAlert } from "lucide-react";
import { useWatch } from "react-hook-form";
import { SettingLineNote } from "src/components";
import { intl, T } from "src/locale";
import { isResolverAddress, MAX_RESOLVER_ADDRESSES, resolverValidate } from "src/modules/ResolverAddress";
import { nginxToApi, nginxToForm, nginxValidate } from "src/modules/SettingsForms";
import { validations } from "src/modules/Validations";
import { RuntimeChips, RuntimeNumber, RuntimeSelect, RuntimeSwitch, RuntimeText } from "./Runtime/fields";
import { Part, RuntimeSection, useRuntimeSection } from "./Runtime/RuntimeSection";
import { StatusAlert } from "./StatusAlert";

const validateNginx = nginxValidate(validations);
const validate = (values, data) => ({ ...validateNginx(values, data), ...resolverValidate(validations, values) });

// a typed address is taken only when it is an address and the list has room, as the save checks it
const isNewAddress = (text, held) => isResolverAddress(text) && held.length < MAX_RESOLVER_ADDRESSES;
const refusedAddresses = (refused) =>
	refused.every(isResolverAddress)
		? intl.formatMessage({ id: "settings.nginx.resolver.too-many" })
		: intl.formatMessage(
				{ id: "settings.nginx.resolver.invalid" },
				{ address: refused.filter((entry) => !isResolverAddress(entry)).join(", ") },
			);

function WorkerProcesses() {
	const { data } = useRuntimeSection();
	const workerProcesses = useWatch({ name: "workerProcesses" });
	// cpuCount is optional in the API: without it only "auto" and the current value are offered
	const counts = Array.from({ length: data.cpuCount ?? 0 }, (_, i) => String(i + 1));
	if (workerProcesses !== "auto" && !counts.includes(workerProcesses)) {
		counts.push(workerProcesses);
	}
	const options = [
		{ value: "auto", label: intl.formatMessage({ id: "settings.nginx.workers.auto" }) },
		...counts.map((count) => ({ value: count, label: count })),
	];
	return (
		<RuntimeSelect
			name="workerProcesses"
			label={<T id="settings.nginx.workers" />}
			hint={data.cpuCount ? <T id="settings.nginx.workers.hint" data={{ cpus: data.cpuCount }} /> : undefined}
			options={options}
		/>
	);
}

function CpuAffinity() {
	const { data } = useRuntimeSection();
	const mode = useWatch({ name: "cpuAffinityMode" });
	const options = ["off", "auto", "custom"].map((value) => ({
		value,
		label: intl.formatMessage({ id: `settings.nginx.cpu-affinity.${value}` }),
	}));
	return (
		<>
			<RuntimeSelect
				name="cpuAffinityMode"
				lockName="cpuAffinity"
				label={<T id="settings.nginx.cpu-affinity" />}
				hint={
					data.cpusAllowed ? (
						<T id="settings.nginx.cpu-affinity.hint" data={{ cpus: data.cpusAllowed }} />
					) : (
						<T id="settings.nginx.cpu-affinity.hint-unknown" />
					)
				}
				options={options}
			/>
			{mode === "custom" ? (
				<RuntimeText
					name="cpuAffinityList"
					lockName="cpuAffinity"
					label={<T id="settings.nginx.cpu-affinity.list" />}
					hint={<T id="settings.nginx.cpu-affinity.list.hint" />}
				/>
			) : null}
		</>
	);
}

function Resolver() {
	const { warningsOf } = useRuntimeSection();
	return (
		<Part titleId="settings.nginx.resolver" infoId="settings.nginx.resolver.info">
			<RuntimeChips
				name="resolverAddresses"
				label={<T id="settings.nginx.resolver.addresses" />}
				hint={<T id="settings.nginx.resolver.addresses.hint" />}
				placeholder="1.1.1.1"
				isValidNew={isNewAddress}
				refusedMessage={refusedAddresses}
				notes={warningsOf("resolverAddresses")}
			/>
			<RuntimeSwitch name="resolverHosts" label={<T id="settings.nginx.resolver.hosts" />} />
			<RuntimeSwitch name="resolverIpv6" label={<T id="settings.nginx.resolver.ipv6" />} />
			<RuntimeText
				name="resolverValid"
				label={<T id="settings.nginx.resolver.valid" />}
				placeholder={intl.formatMessage({ id: "settings.nginx.resolver.valid.placeholder" })}
			/>
		</Part>
	);
}

function Tls() {
	// post-quantum only needs TLS 1.3 and X25519MLKEM768, so these two show off as soon as it is switched on
	const off = Boolean(useWatch({ name: "forceMlkem" }));
	return (
		<Part titleId="settings.nginx.tls" infoId="settings.nginx.tls.description">
			<SettingLineNote>
				<StatusAlert variant="warning" icon={TriangleAlert} id="settings.nginx.tls.warning" />
			</SettingLineNote>
			<RuntimeSwitch
				name="tls12"
				forcedOff={off}
				label={<T id="settings.nginx.tls12" />}
				hint={<T id="settings.nginx.tls12.hint" />}
			/>
			<RuntimeSwitch
				name="forceMlkem"
				label={<T id="settings.nginx.force-mlkem" />}
				hint={<T id="settings.nginx.force-mlkem.hint" />}
			/>
			<RuntimeSwitch
				name="secpCurves"
				forcedOff={off}
				label={<T id="settings.nginx.secp-curves" />}
				hint={<T id="settings.nginx.secp-curves.hint" />}
			/>
			<RuntimeSwitch
				name="rsaPkcs1"
				label={<T id="settings.nginx.rsa-pkcs1" />}
				hint={<T id="settings.nginx.rsa-pkcs1.hint" />}
			/>
		</Part>
	);
}

export default function Nginx() {
	return (
		<RuntimeSection
			group="nginx"
			titleId="settings.nginx"
			leadId="settings.nginx.intro"
			toForm={nginxToForm}
			toApi={nginxToApi}
			validate={validate}
		>
			<Part titleId="settings.nginx.workers-part" infoId="settings.nginx.workers-part.description">
				<WorkerProcesses />
				<RuntimeNumber
					name="workerConnections"
					label={<T id="settings.nginx.connections" />}
					hint={<T id="settings.nginx.connections.hint" />}
					min={64}
					max={65535}
				/>
				<RuntimeText
					name="workerShutdownTimeout"
					label={<T id="settings.nginx.shutdown-timeout" />}
					hint={<T id="settings.nginx.shutdown-timeout.hint" />}
				/>
				<CpuAffinity />
			</Part>
			<Resolver />
			<Part titleId="settings.nginx.logging" infoId="settings.nginx.logging.description">
				<RuntimeSwitch
					name="logNotFound"
					label={<T id="settings.nginx.log-not-found" />}
					hint={<T id="settings.nginx.log-not-found.hint" />}
				/>
			</Part>
			<Tls />
			<Part titleId="settings.nginx.modules" infoId="settings.nginx.modules.description">
				<RuntimeSwitch
					name="moduleNjs"
					label={<T id="settings.nginx.module.njs" />}
					hint={<T id="settings.nginx.module.njs.hint" />}
				/>
				<RuntimeSwitch
					name="moduleLdap"
					label={<T id="settings.nginx.module.ldap" />}
					hint={<T id="settings.nginx.module.ldap.hint" />}
				/>
				<RuntimeSwitch
					name="moduleNtlm"
					label={<T id="settings.nginx.module.ntlm" />}
					hint={<T id="settings.nginx.module.ntlm.hint" />}
				/>
				<RuntimeSwitch
					name="moduleVts"
					label={<T id="settings.nginx.module.vts" />}
					hint={<T id="settings.nginx.module.vts.hint" />}
				/>
			</Part>
		</RuntimeSection>
	);
}
