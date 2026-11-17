import { CopyIcon } from "lucide-react";
import { Fragment } from "react";
import { ErrorAlert, Loading } from "src/components";
import { SettingLine, SettingLineNote } from "src/components/Form/SettingLine";
import { TapTooltip } from "src/components/TapTooltip";
import { Button } from "src/components/ui/button";
import { useMcpTools } from "src/hooks";
import { intl, T } from "src/locale";
import { claudeCodeCommand, desktopConfig, endpointOf, NEEDS, toolsByNeed } from "src/modules/Mcp";
import { showSuccess } from "src/notifications";
import { SettingsCard } from "./SettingsCard";

const copyText = async (text) => {
	try {
		await navigator.clipboard.writeText(text);
		showSuccess(intl.formatMessage({ id: "settings.api-access.mcp.copied" }));
	} catch {
		// no clipboard access (a browser setting or policy): the text stays selectable in its block
	}
};

function CopyButton({ text }) {
	const name = intl.formatMessage({ id: "api-tokens.copy" });
	return (
		<TapTooltip content={name} tap={false}>
			<Button type="button" variant="outline" size="icon-sm" aria-label={name} onClick={() => copyText(text)}>
				<CopyIcon aria-hidden="true" />
			</Button>
		</TapTooltip>
	);
}

/** A code block with its Copy button; long lines scroll inside the block */
function CodeBlock({ text }) {
	return (
		<div className="flex min-w-0 items-start gap-2">
			<pre className="m-0 min-w-0 flex-1 overflow-x-auto rounded-md border bg-muted px-3 py-2 font-mono text-xs [font-variant-ligatures:none]">
				{text}
			</pre>
			<CopyButton text={text} />
		</div>
	);
}

function ToolsLine({ id }) {
	const { data, isPending, error } = useMcpTools();
	const groups = data ? toolsByNeed(data) : null;
	return (
		<SettingLine id={id} layout="block" title={<T id="settings.api-access.mcp.tools" />}>
			{error ? <ErrorAlert error={error} /> : null}
			{isPending ? <Loading noLogo /> : null}
			{groups ? (
				<dl className="m-0 mt-2 space-y-3">
					{NEEDS.map((need) =>
						groups[need].length === 0 ? null : (
							<Fragment key={need}>
								<dt className="font-medium text-sm">
									<T id={`settings.api-access.mcp.needs.${need}`} />
								</dt>
								<dd className="m-0 flex flex-wrap gap-1.5">
									{groups[need].map((name) => (
										<code
											key={name}
											className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-xs"
										>
											{name}
										</code>
									))}
								</dd>
							</Fragment>
						),
					)}
				</dl>
			) : null}
		</SettingLine>
	);
}

/**
 * Settings, API access: the MCP endpoint, example client configurations and the tools per permission
 */
function McpCard() {
	const endpoint = endpointOf(window.location.origin);
	return (
		<SettingsCard title={<T id="settings.api-access.mcp" />} info={<T id="settings.api-access.mcp.info" />} lines>
			<SettingLine id="mcp-endpoint" layout="block" title={<T id="settings.api-access.mcp.endpoint" />}>
				<div className="mt-2">
					<CodeBlock text={endpoint} />
				</div>
			</SettingLine>
			<SettingLine id="mcp-claude-code" layout="block" title={<T id="settings.api-access.mcp.claude-code" />}>
				<div className="mt-2">
					<CodeBlock text={claudeCodeCommand(endpoint)} />
				</div>
			</SettingLine>
			<SettingLine id="mcp-other" layout="block" title={<T id="settings.api-access.mcp.other" />}>
				<div className="mt-2">
					<CodeBlock text={desktopConfig(endpoint)} />
				</div>
			</SettingLine>
			<ToolsLine id="mcp-tools" />
			<SettingLineNote className="text-muted-foreground text-sm">
				<T id="settings.api-access.mcp.reach" />
			</SettingLineNote>
		</SettingsCard>
	);
}

export { McpCard };
