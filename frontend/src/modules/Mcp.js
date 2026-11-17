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
// mcp-remote expands this reference to the AUTH_HEADER variable of env itself: the literal text, built from two parts
// so it is not taken for a template string mistake
const AUTH_HEADER_REF = ["$", "{AUTH_HEADER}"].join("");

const desktopConfig = (endpoint) =>
	JSON.stringify(
		{
			mcpServers: {
				npmpro: {
					command: "npx",
					// no space inside an argument (it breaks on Windows): the header value comes from env, as mcp-remote
					// recommends
					args: ["-y", "mcp-remote", endpoint, "--header", `Authorization:${AUTH_HEADER_REF}`],
					env: { AUTH_HEADER: `Bearer ${PLACEHOLDER}` },
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

export { AUTH_HEADER_REF, claudeCodeCommand, desktopConfig, endpointOf, NEEDS, toolsByNeed };
