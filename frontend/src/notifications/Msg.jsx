import { IconCheck, IconExclamationCircle } from "@tabler/icons-react";
import cn from "clsx";
import { intl } from "src/locale";

function Msg({ data, closeToast }) {
	const isError = data.type === "error";
	const Icon = isError ? IconExclamationCircle : IconCheck;
	return (
		<div
			className={cn("toast", "show", data.type)}
			role={isError ? "alert" : "status"}
			aria-live={isError ? "assertive" : "polite"}
			aria-atomic="true"
		>
			<div className="toast-header">
				<Icon className={cn("icon me-2", isError ? "text-red" : "text-green")} aria-hidden="true" />
				<strong className="me-auto">{data.title}</strong>
				<button
					type="button"
					className="btn-close ms-2"
					aria-label={intl.formatMessage({ id: "close" })}
					onClick={closeToast}
				/>
			</div>
			<div className="toast-body">{data.message}</div>
		</div>
	);
}

export { Msg };
