import { IconAlertTriangle } from "@tabler/icons-react";
import { useWatch } from "react-hook-form";
import { intl, T } from "src/locale";
import { nginxValidate } from "src/modules/SettingsForms";
import { validations } from "src/modules/Validations";
import { RuntimeNumber, RuntimeSelect, RuntimeSwitch, RuntimeText } from "./Runtime/fields";
import { Part, RuntimeSection, useRuntimeSection } from "./Runtime/RuntimeSection";
import { StatusAlert } from "./StatusAlert";

const KEYS = [
	"logNotFound",
	"tls12",
	"forceMlkem",
	"secpCurves",
	"rsaPkcs1",
	"moduleNjs",
	"moduleLdap",
	"moduleNtlm",
	"moduleVts",
];

const toForm = (data) => ({
	workerProcesses: String(data.workerProcesses),
	workerConnections: String(data.workerConnections),
	workerShutdownTimeout: data.workerShutdownTimeout,
	...Object.fromEntries(KEYS.map((key) => [key, Boolean(data[key])])),
});
const toApi = (values) => ({
	...values,
	workerConnections: Number(values.workerConnections),
});

const validate = nginxValidate(validations);

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

function Tls() {
	// post-quantum only needs TLS 1.3 and X25519MLKEM768, so these two show off as soon as it is switched on
	const off = Boolean(useWatch({ name: "forceMlkem" }));
	return (
		<Part titleId="settings.nginx.tls">
			<StatusAlert variant="warning" icon={IconAlertTriangle} id="settings.nginx.tls.warning" />
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
		<RuntimeSection group="nginx" titleId="settings.nginx" toForm={toForm} toApi={toApi} validate={validate}>
			<p className="text-secondary">
				<T id="settings.nginx.intro" />
			</p>
			<Part titleId="settings.nginx.workers-part">
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
			</Part>
			<Part titleId="settings.nginx.logging">
				<RuntimeSwitch
					name="logNotFound"
					label={<T id="settings.nginx.log-not-found" />}
					hint={<T id="settings.nginx.log-not-found.hint" />}
				/>
			</Part>
			<Tls />
			<Part titleId="settings.nginx.modules" last>
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
