import { ApiOperation } from "./ApiOperation";
import { InlineMarkdown } from "./InlineMarkdown";

/**
 * One group: its name, intro and routes
 *
 * @param {Object} props
 * @param {{ name: string, intro: string, operations: object[] }} props.group
 * @param {() => void} props.onOpenGuide
 */
export function ApiGroup({ group, onOpenGuide }) {
	return (
		<section id={group.name} className="scroll-mt-[76px]">
			<div className="border-b px-6 pt-10 pb-6 lg:px-10">
				<h2 className="m-0 mb-2 border-primary border-l-[3px] pl-3 font-mono font-semibold text-2xl">
					{group.name}
				</h2>
				<InlineMarkdown text={group.intro} className="text-muted-foreground text-sm" />
			</div>
			{group.operations.map((operation) => (
				<ApiOperation key={operation.anchor} operation={operation} onOpenGuide={onOpenGuide} />
			))}
		</section>
	);
}
