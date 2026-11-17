const PLACEHOLDER = "YOUR_TOKEN";
const NEEDS = ["view", "manage", "delete", "admin"];

/**
 * The MCP endpoint of this admin address
 *
 * @param {string} origin  e.g. window.location.origin
 * @returns {string}
 */
const endpointOf = (origin) => `${origin}/api/mcp`;

/**
 * The Claude Code command that adds the server; the token is a placeholder
 *
 * @param {string} endpoint
 * @returns {string}
 */
const claudeCodeCommand = (endpoint) =>
	`claude mcp add --transport http npmpro ${endpoint} --header "Authorization: Bearer ${PLACEHOLDER}"`;

/**
 * The client configuration for Claude Desktop and other clients that start a local command (mcp-remote); the token is a
 * placeholder
 *
 * @param {string} endpoint
 * @returns {string} JSON
 */
const desktopConfig = (endpoint) =>
	JSON.stringify(
		{
			mcpServers: {
				npmpro: {
					command: "npx",
					args: ["-y", "mcp-remote", endpoint, "--header", `Authorization: Bearer ${PLACEHOLDER}`],
				},
			},
		},
		null,
		2,
	);

/**
 * The tool names per permission a token needs, each list sorted
 *
 * @param {{name: string, needs: string}[]} tools  from GET /api/mcp/tools
 * @returns {{view: string[], manage: string[], delete: string[], admin: string[]}}
 */
const toolsByNeed = (tools) => {
	const groups = Object.fromEntries(NEEDS.map((need) => [need, []]));
	for (const { name, needs } of tools) groups[needs]?.push(name);
	for (const need of NEEDS) groups[need].sort();
	return groups;
};

export { claudeCodeCommand, desktopConfig, endpointOf, NEEDS, toolsByNeed };
