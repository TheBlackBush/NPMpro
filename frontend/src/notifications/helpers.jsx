import { toast } from "react-toastify";
import { intl } from "src/locale";
import { Msg } from "./Msg";

const showSuccess = (message) => {
	toast(Msg, {
		className: "bg-transparent shadow-none border-0",
		data: {
			type: "success",
			title: intl.formatMessage({ id: "notification.success" }),
			message,
		},
	});
};

const showError = (message) => {
	toast(<Msg />, {
		className: "bg-transparent shadow-none border-0",
		data: {
			type: "error",
			title: intl.formatMessage({ id: "notification.error" }),
			message,
		},
	});
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
	row?.enabled && row.npmplusNginxOnline === false ? row.npmplusNginxErr || "" : null;

const NginxConfigErrorMsg = ({ obj, nginxErr }) => (
	<>
		{intl.formatMessage({ id: "notification.object-nginx-error" }, { object: intl.formatMessage({ id: obj }) })}
		{nginxErr && <pre className="mt-2 mb-0 text-wrap">{nginxErr}</pre>}
	</>
);

const showNginxConfigError = (obj, nginxErr) => {
	toast(Msg, {
		className: "bg-transparent shadow-none border-0",
		autoClose: false,
		data: {
			type: "error",
			title: intl.formatMessage({ id: "notification.nginx-config-error" }),
			message: <NginxConfigErrorMsg obj={obj} nginxErr={nginxErr} />,
		},
	});
};

export { getNginxConfigError, NginxConfigErrorMsg, showError, showNginxConfigError, showObjectSuccess };
