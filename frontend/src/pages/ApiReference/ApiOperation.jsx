import { Lock } from "lucide-react";
import { T } from "src/locale";
import { CodePanel } from "./CodePanel";
import { FieldTable, ParamTable } from "./FieldTable";
import { InlineMarkdown } from "./InlineMarkdown";
import { MethodBadge } from "./MethodBadge";
import { ResponseTable } from "./ResponseTable";

const HEADING = "m-0 mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide";

const PARAM_SPLIT = /(?<param>\{[^}]+\})/u;

// The path with its {params} in the muted colour (a part's offset in the path is its key)
const PathText = ({ path }) => {
	let offset = 0;
	const parts = path.split(PARAM_SPLIT).map((part) => {
		const key = offset;
		offset += part.length;
		return part.startsWith("{") ? (
			<span key={key} className="text-muted-foreground">
				{part}
			</span>
		) : (
			part
		);
	});
	return <code className="break-all font-mono text-[13px]">{parts}</code>;
};

function Needs({ value }) {
	return (
		<p className="m-0 mt-3 inline-flex max-w-full items-center gap-1.5 rounded-full border bg-muted px-3 py-1 text-[12.5px] text-muted-foreground">
			<Lock size={13} aria-hidden="true" />
			<span className="font-semibold text-[10.5px] uppercase tracking-wide">
				<T id="api-reference.needs" />
			</span>
			<span className="font-semibold text-foreground">{value}</span>
		</p>
	);
}

/**
 * One route: title, method and path, text, Needs, fields and answers in the middle, code on the right
 *
 * @param {Object} props
 * @param {object} props.operation  a route of the reference view model
 * @param {() => void} props.onOpenGuide
 */
export function ApiOperation({ operation, onOpenGuide }) {
	const { body } = operation;
	return (
		<article
			id={operation.anchor}
			className="scroll-mt-20 border-b px-6 py-8 [contain-intrinsic-size:auto_480px] [content-visibility:auto] lg:px-10 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] xl:gap-10"
		>
			<div className="min-w-0">
				<div className="flex flex-wrap items-center gap-2">
					<MethodBadge method={operation.method} filled />
					<PathText path={operation.path} />
				</div>
				<h3 className="mt-2 mb-2 font-semibold text-lg">{operation.summary}</h3>
				{operation.text ? <InlineMarkdown text={operation.text} className="text-sm" /> : null}
				{operation.needs ? <Needs value={operation.needs} /> : null}
				{operation.params.length > 0 ? (
					<section className="mt-6">
						<h4 className={HEADING}>
							<T id="api-reference.parameters" />
						</h4>
						<ParamTable params={operation.params} />
					</section>
				) : null}
				{body && body.fields.length > 0 ? (
					<section className="mt-6">
						<h4 className={HEADING}>
							<T id="api-reference.request-body" />
							{body.mediaType && body.mediaType !== "application/json" ? (
								<span className="ms-2 font-mono normal-case">{body.mediaType}</span>
							) : null}
						</h4>
						<FieldTable rows={body.fields} />
					</section>
				) : null}
				{operation.responses.length > 0 ? (
					<section className="mt-6">
						<h4 className={HEADING}>
							<T id="api-reference.responses" />
						</h4>
						<ResponseTable responses={operation.responses} onOpenGuide={onOpenGuide} />
					</section>
				) : null}
			</div>
			<div className="mt-6 xl:mt-0">
				<CodePanel operation={operation} />
			</div>
		</article>
	);
}
