import { T } from "src/locale";

/**
 * Tabler alert with an icon for a settings section status line (https://docs.tabler.io/ui/components/alerts).
 * Pass `id` for a translated text or `children` for own content.
 */
function StatusAlert({ variant, icon: Icon, id, data, className, children }) {
	return (
		<div className={`alert alert-${variant}${className ? ` ${className}` : ""}`} role="status">
			<div className="alert-icon">
				<Icon className="icon" aria-hidden="true" />
			</div>
			<div className="text-break">{id ? <T id={id} data={data} /> : children}</div>
		</div>
	);
}

export { StatusAlert };
