import { toast } from "sonner";
import { ApiErrorContent } from "src/components/ErrorAlert";
import { intl } from "src/locale";

const showSuccess = (message) => {
	toast.success(intl.formatMessage({ id: "notification.success" }), { description: message });
};

const showError = (message) => {
	toast.error(intl.formatMessage({ id: "notification.error" }), { description: message, duration: 10_000 });
};

const showApiError = (err) => {
	showError(<ApiErrorContent error={err} />);
};

const showObjectSuccess = (obj, action) => {
	showSuccess(
		intl.formatMessage(
			{
				id: `notification.object-${action}`,
			},
			{ object: intl.formatMessage({ id: obj }) },
		),
	);
};

/**
 * The backend saves a host even when nginx rejects its config, it then marks the host offline.
 * Returns the nginx error (possibly empty) for such a host, or null if the config is fine.
 */
const getNginxConfigError = (row) =>
	row?.enabled && row.npmproNginxOnline === false ? row.npmproNginxErr || "" : null;

const NginxConfigErrorMsg = ({ obj, nginxErr }) => (
	<>
		{intl.formatMessage({ id: "notification.object-nginx-error" }, { object: intl.formatMessage({ id: obj }) })}
		{nginxErr && <pre className="mt-2 whitespace-pre-wrap font-mono text-xs">{nginxErr}</pre>}
	</>
);

const showNginxConfigError = (obj, nginxErr) => {
	toast.error(intl.formatMessage({ id: "notification.nginx-config-error" }), {
		description: <NginxConfigErrorMsg obj={obj} nginxErr={nginxErr} />,
		duration: Number.POSITIVE_INFINITY,
	});
};

export {
	getNginxConfigError,
	NginxConfigErrorMsg,
	showApiError,
	showError,
	showNginxConfigError,
	showObjectSuccess,
	showSuccess,
};
