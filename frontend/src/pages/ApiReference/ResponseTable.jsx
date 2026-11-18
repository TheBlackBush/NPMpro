import { Button } from "src/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "src/components/ui/table";
import { T } from "src/locale";
import { InlineMarkdown } from "./InlineMarkdown";

const STATUS_CLASS = { 2: "text-method-post", 3: "text-method-put", 4: "text-method-delete", 5: "text-method-delete" };

/**
 * The answers of a route with the note that errors share one shape
 *
 * @param {Object} props
 * @param {Array<{ status: string, description: string }>} props.responses
 * @param {() => void} props.onOpenGuide  opens the full guide
 */
export function ResponseTable({ responses, onOpenGuide }) {
	return (
		<>
			<Table className="min-w-[24rem] table-fixed">
				<TableHeader>
					<TableRow>
						<TableHead className="w-20">
							<T id="api-reference.code" />
						</TableHead>
						<TableHead>
							<T id="api-reference.description" />
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{responses.map((response) => (
						<TableRow key={response.status}>
							<TableCell
								className={`align-top font-mono font-semibold ${STATUS_CLASS[response.status[0]] ?? ""}`}
							>
								{response.status}
							</TableCell>
							<TableCell className="whitespace-normal break-words align-top [overflow-wrap:anywhere]">
								<InlineMarkdown text={response.description} />
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
			<p className="mt-2 mb-0 text-muted-foreground text-xs">
				<T id="api-reference.errors-note" />{" "}
				<Button type="button" variant="link" size="xs" className="h-auto p-0 text-xs" onClick={onOpenGuide}>
					<T id="api-reference.full-guide" />
				</Button>
			</p>
		</>
	);
}
