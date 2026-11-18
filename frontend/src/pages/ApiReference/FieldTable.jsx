import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "src/components/ui/table";
import { T } from "src/locale";
import { InlineMarkdown } from "./InlineMarkdown";

const DEPTH_CLASS = "data-[depth=1]:pl-4 data-[depth=2]:pl-8 data-[depth=3]:pl-12";

const Required = () => (
	<span className="ms-1.5 font-semibold text-[10.5px] text-method-delete uppercase tracking-wide">
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
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>
						<T id="api-reference.field" />
					</TableHead>
					<TableHead>
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
						<TableCell data-depth={row.depth} className={DEPTH_CLASS}>
							<code className="font-mono text-[12.5px]">{row.name}</code>
							{row.required ? <Required /> : null}
						</TableCell>
						<TableCell className="text-muted-foreground">{row.type}</TableCell>
						<TableCell className="whitespace-normal">
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
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>
						<T id="api-reference.name" />
					</TableHead>
					<TableHead>
						<T id="api-reference.in" />
					</TableHead>
					<TableHead>
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
						<TableCell>
							<code className="font-mono text-[12.5px]">{param.name}</code>
							{param.required ? <Required /> : null}
						</TableCell>
						<TableCell className="text-muted-foreground">{param.in}</TableCell>
						<TableCell className="text-muted-foreground">{param.type}</TableCell>
						<TableCell className="whitespace-normal">
							<InlineMarkdown text={param.description} />
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}
