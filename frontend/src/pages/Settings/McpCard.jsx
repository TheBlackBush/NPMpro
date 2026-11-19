import { Network, ShieldAlert } from "lucide-react";
import { Fragment } from "react";

import { ErrorAlert, Loading } from "src/components";
import { CodeBox } from "src/components/CodeBox";
import { SettingLine, SettingLineNote } from "src/components/Form/SettingLine";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "src/components/ui/tabs";
import { useMcpTools } from "src/hooks";
import { intl, T } from "src/locale";
import { claudeCodeCommand, desktopConfig, endpointOf, NEEDS, toolsByNeed } from "src/modules/Mcp";
import { SettingsCard } from "./SettingsCard";

/** The client configurations: a view switch (Tabs) over one code box, so the line shows one box at a time */
function ConnectLine({ endpoint }) {
	return (
		<SettingLine
			id="mcp-connect"
			layout="block"
			title={<T id="settings.api-access.mcp.connect" />}
			hint={<T id="settings.api-access.mcp.connect.hint" />}
			control={
				<Tabs defaultValue="claude-code" className="min-w-0 gap-2" data-mcp-clients="">
					<TabsList className="w-full group-data-[orientation=horizontal]/tabs:h-auto @lg:w-fit">
						<TabsTrigger
							value="claude-code"
							className="h-auto min-h-7 whitespace-normal @lg:flex-none @lg:px-3 @lg:whitespace-nowrap"
						>
							<T id="settings.api-access.mcp.claude-code" />
						</TabsTrigger>
						<TabsTrigger
							value="other"
							className="h-auto min-h-7 whitespace-normal @lg:flex-none @lg:px-3 @lg:whitespace-nowrap"
						>
							<T id="settings.api-access.mcp.other" />
						</TabsTrigger>
					</TabsList>
					<TabsContent value="claude-code" className="mt-0">
						<CodeBox
							text={claudeCodeCommand(endpoint)}
							label={intl.formatMessage({ id: "settings.api-access.mcp.claude-code" })}
						/>
					</TabsContent>
					<TabsContent value="other" className="mt-0">
						<CodeBox
							text={desktopConfig(endpoint)}
							wrap="scroll"
							label={intl.formatMessage({ id: "settings.api-access.mcp.other" })}
							aria-label={intl.formatMessage({ id: "settings.api-access.mcp.other" })}
						/>
					</TabsContent>
				</Tabs>
			}
		/>
	);
}

function ToolsLine({ id }) {
	const { data, isPending, error } = useMcpTools();
	const groups = data ? toolsByNeed(data) : null;
	return (
		<SettingLine
			id={id}
			layout="block"
			title={<T id="settings.api-access.mcp.tools" />}
			hint={data ? <T id="settings.api-access.mcp.tools.hint" data={{ count: data.length }} /> : null}
			control={
				<>
					{error ? <ErrorAlert error={error} /> : null}
					{isPending ? <Loading noLogo /> : null}
					{groups ? (
						<dl className="m-0 grid grid-cols-1 gap-x-4 gap-y-3 @lg:grid-cols-[12rem_minmax(0,1fr)]">
							{NEEDS.map((need) =>
								groups[need].length === 0 ? null : (
									<Fragment key={need}>
										<dt className="flex items-baseline gap-1.5 font-semibold text-sm @lg:pt-0.5">
											<T id={`settings.api-access.mcp.needs.${need}`} />
											<span className="font-normal text-muted-foreground">
												{groups[need].length}
											</span>
										</dt>
										<dd className="m-0 mb-1 flex flex-wrap gap-1.5 @lg:mb-0">
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
				</>
			}
		/>
	);
}

/**
 * Settings, API access: the MCP endpoint, example client configurations and the tools per permission
 */
function McpCard() {
	const endpoint = endpointOf(window.location.origin);
	return (
		<SettingsCard title={<T id="settings.api-access.mcp" />} info={<T id="settings.api-access.mcp.info" />} lines>
			<SettingLine
				id="mcp-endpoint"
				layout="block"
				title={<T id="settings.api-access.mcp.endpoint" />}
				control={
					<CodeBox text={endpoint} label={intl.formatMessage({ id: "settings.api-access.mcp.endpoint" })} />
				}
			/>
			<ConnectLine endpoint={endpoint} />
			<ToolsLine id="mcp-tools" />
			<SettingLineNote icon={ShieldAlert} lead={<T id="settings.api-access.mcp.certificate.lead" />}>
				<T id="settings.api-access.mcp.certificate" />
			</SettingLineNote>
			<SettingLineNote icon={Network} lead={<T id="settings.api-access.mcp.reach.lead" />}>
				<T id="settings.api-access.mcp.reach" />
			</SettingLineNote>
		</SettingsCard>
	);
}

export { McpCard };
