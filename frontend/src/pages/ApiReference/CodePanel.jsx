import { createContext, useContext } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "src/components/ui/tabs";
import { intl, T } from "src/locale";
import { buildCurl, buildNode, buildPython } from "src/modules/ApiRequest";
import { CodeBlock } from "./CodeBlock";
import { TryIt } from "./TryIt";

/** The code language of the whole page: `{ language, setLanguage }`, kept in memory only */
export const CodeLanguageContext = createContext({ language: "curl", setLanguage: () => undefined });

const BUILDERS = { curl: buildCurl, node: buildNode, python: buildPython };
const LANGUAGES = ["curl", "node", "python"];

const exampleText = (example) => (typeof example === "string" ? example : JSON.stringify(example, null, 2));

/**
 * The right column of a route: the request as curl, Node or Python and the example of the first 2xx answer
 *
 * @param {Object} props
 * @param {object} props.operation  a route of the reference view model
 */
export function CodePanel({ operation }) {
	const { language, setLanguage } = useContext(CodeLanguageContext);
	const origin = window.location.origin;
	const success = operation.responses.find(
		(response) => response.status.startsWith("2") && response.example !== undefined,
	);

	return (
		<div className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-20 xl:self-start">
			<div>
				<Tabs value={language} onValueChange={setLanguage}>
					<div className="flex items-center justify-between gap-2">
						<h4 className="m-0 font-medium text-muted-foreground text-xs uppercase tracking-wide">
							<T id="api-reference.request" />
						</h4>
						<TabsList aria-label={intl.formatMessage({ id: "api-reference.code-language" })}>
							{LANGUAGES.map((name) => (
								<TabsTrigger key={name} value={name}>
									<T id={`api-reference.tab-${name}`} />
								</TabsTrigger>
							))}
						</TabsList>
					</div>
					{LANGUAGES.map((name) => (
						<TabsContent key={name} value={name} data-code-tab={name}>
							<CodeBlock
								text={BUILDERS[name]({ origin, operation })}
								language={name === "node" ? "js" : "shell"}
							/>
						</TabsContent>
					))}
				</Tabs>
			</div>
			<TryIt operation={operation} />
			{success ? (
				<div>
					<h4 className="m-0 mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
						<T id="api-reference.response" /> <span className="font-mono">{success.status}</span>
					</h4>
					<CodeBlock text={exampleText(success.example)} language="json" />
				</div>
			) : null}
		</div>
	);
}
