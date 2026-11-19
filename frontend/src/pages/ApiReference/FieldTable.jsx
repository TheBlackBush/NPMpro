import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "src/components/ui/table";
import { T } from "src/locale";
import { InlineMarkdown } from "./InlineMarkdown";

// fixed column widths so a long type or description wraps inside its cell; a phone scrolls the table in its box
const TABLE = "min-w-[32rem] table-fixed";
const WRAP = "whitespace-normal break-words [overflow-wrap:anywhere]";

const DEPTH_CLASS = "data-[depth=1]:pl-4 data-[depth=2]:pl-8 data-[depth=3]:pl-12";

const Required = () => (
	<span className="ms-1.5 inline-block whitespace-nowrap font-semibold text-[10.5px] text-method-delete uppercase tracking-wide">
		<T id="api-reference.required" />
	</span>
);

/**
 * The fields of a request body, nested ones indented by their depth (1 to 3)
 *
 * @param {Object} props
 * @param {Array<{ name: string, type: string, required: boolean, description: string, depth: number }>} props.rows
 */
export function FieldTable({ rows }) {
	return (
		<Table className={TABLE}>
			<TableHeader>
				<TableRow>
					<TableHead className="w-[30%]">
						<T id="api-reference.field" />
					</TableHead>
					<TableHead className="w-[25%]">
						<T id="api-reference.type" />
					</TableHead>
					<TableHead>
						<T id="api-reference.description" />
					</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{rows.map((row) => (
					<TableRow key={row.name}>
						<TableCell data-depth={row.depth} className={`${WRAP} align-top ${DEPTH_CLASS}`}>
							<code className="font-mono text-[12.5px]">{row.name}</code>
							{row.required ? <Required /> : null}
						</TableCell>
						<TableCell className={`${WRAP} align-top text-muted-foreground`}>{row.type}</TableCell>
						<TableCell className={`${WRAP} align-top`}>
							<InlineMarkdown text={row.description} />
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}

/**
 * The path and query parameters of a route
 *
 * @param {Object} props
 * @param {Array<{ name: string, in: string, type: string, required: boolean, description: string }>} props.params
 */
export function ParamTable({ params }) {
	return (
		<Table className={TABLE}>
			<TableHeader>
				<TableRow>
					<TableHead className="w-[25%]">
						<T id="api-reference.name" />
					</TableHead>
					<TableHead className="w-[10%]">
						<T id="api-reference.in" />
					</TableHead>
					<TableHead className="w-[20%]">
						<T id="api-reference.type" />
					</TableHead>
					<TableHead>
						<T id="api-reference.description" />
					</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{params.map((param) => (
					<TableRow key={`${param.in}-${param.name}`}>
						<TableCell className={`${WRAP} align-top`}>
							<code className="font-mono text-[12.5px]">{param.name}</code>
							{param.required ? <Required /> : null}
						</TableCell>
						<TableCell className="align-top text-muted-foreground">{param.in}</TableCell>
						<TableCell className={`${WRAP} align-top text-muted-foreground`}>{param.type}</TableCell>
						<TableCell className={`${WRAP} align-top`}>
							<InlineMarkdown text={param.description} />
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}
