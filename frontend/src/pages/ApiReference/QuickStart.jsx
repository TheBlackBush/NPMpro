import { useMemo } from "react";
import { Button } from "src/components/ui/button";
import { T } from "src/locale";
import { buildCurl } from "src/modules/ApiRequest";
import { CodeBlock } from "./CodeBlock";

const FACTS = [
	{ id: "api-reference.fact.owner" },
	{ id: "api-reference.fact.delete" },
	{ id: "api-reference.fact.session" },
	{ id: "api-reference.fact.errors", data: { codes: "400 401 403 404 413 429" } },
];

const code = (text) => <code className="rounded bg-muted px-1 font-mono text-xs">{text}</code>;

function Step({ number, title, text, data }) {
	return (
		<li className="m-0 flex-1 list-none rounded-lg border bg-card p-3">
			<div className="mb-1 flex items-center gap-2 font-medium text-sm">
				<span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-primary text-xs">
					{number}
				</span>
				<T id={title} />
			</div>
			<p className="m-0 text-muted-foreground text-sm">
				<T id={text} data={data} />
			</p>
		</li>
	);
}

/**
 * The compact Getting started strip: the three steps, the facts that matter, the full guide button and a first
 * request (GET /nginx/proxy-hosts for this address)
 *
 * @param {Object} props
 * @param {object} props.reference  the reference view model
 * @param {() => void} props.onOpenGuide  opens the full guide
 */
export function QuickStart({ reference, onOpenGuide }) {
	const first = useMemo(
		() =>
			reference.groups
				.flatMap((group) => group.operations)
				.find((op) => op.method === "GET" && op.path === "/nginx/proxy-hosts"),
		[reference],
	);
	const origin = window.location.origin;

	return (
		<section id="getting-started" className="scroll-mt-20 border-b p-6">
			<div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
				<div className="min-w-0">
					<h2 className="m-0 mb-1 font-semibold text-xl">
						<T id="api-reference.title" />
					</h2>
					<p className="mb-4 text-muted-foreground text-sm">
						<T id="api-reference.lead" />
					</p>
					<ol className="m-0 mb-4 flex list-none flex-col gap-3 p-0 md:flex-row">
						<Step number={1} title="api-reference.step1.title" text="api-reference.step1.text" />
						<Step
							number={2}
							title="api-reference.step2.title"
							text="api-reference.step2.text"
							data={{ header: code("Authorization: Bearer npmpro_...") }}
						/>
						<Step
							number={3}
							title="api-reference.step3.title"
							text="api-reference.step3.text"
							data={{ url: code(`${origin}/api`) }}
						/>
					</ol>
					<ul className="m-0 mb-4 flex list-none flex-wrap gap-2 p-0">
						{FACTS.map((fact) => (
							<li key={fact.id} className="rounded-full border bg-muted px-2.5 py-0.5 text-xs">
								<T id={fact.id} data={fact.data} />
							</li>
						))}
					</ul>
					<Button type="button" variant="outline" size="sm" onClick={onOpenGuide}>
						<T id="api-reference.full-guide" />
					</Button>
				</div>
				{first ? (
					<div className="min-w-0">
						<h3 className="m-0 mb-2 font-medium text-sm">
							<T id="api-reference.first-request" />
						</h3>
						<CodeBlock text={buildCurl({ origin, operation: first })} language="shell" />
					</div>
				) : null}
			</div>
		</section>
	);
}
