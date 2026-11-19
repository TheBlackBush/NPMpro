import { cn } from "src/lib/utils";

const METHOD_CLASS = {
	GET: "text-method-get",
	POST: "text-method-post",
	PUT: "text-method-put",
	PATCH: "text-method-put",
	DELETE: "text-method-delete",
};

const METHOD_BG = {
	GET: "bg-method-get-bg",
	POST: "bg-method-post-bg",
	PUT: "bg-method-put-bg",
	PATCH: "bg-method-put-bg",
	DELETE: "bg-method-delete-bg",
};

/** The text colour class of an HTTP method (PATCH shares the PUT colour) */
export const methodClass = (method) => METHOD_CLASS[method];

/** The method of a route in its colour; `filled` adds the tinted background of the route heading */
export function MethodBadge({ method, className, filled = false }) {
	return (
		<span
			className={cn(
				"font-mono font-semibold text-[10px]",
				METHOD_CLASS[method],
				filled && ["rounded px-1.5 py-0.5 text-[11px]", METHOD_BG[method]],
				className,
			)}
		>
			{method}
		</span>
	);
}
