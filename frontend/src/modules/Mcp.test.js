import assert from "node:assert/strict";
import { it } from "node:test";
import en from "../../translations/ui/en.json" with { type: "json" };
import { AUTH_HEADER_REF, claudeCodeCommand, desktopConfig, endpointOf, NEEDS, toolsByNeed } from "./Mcp.js";

const ENDPOINT = "https://npm.example.com:81/api/mcp";

it("endpointOf appends the MCP path to the origin", () => {
	assert.equal(endpointOf("https://npm.example.com:81"), ENDPOINT);
});

it("claudeCodeCommand is the add command with a token placeholder", () => {
	assert.equal(
		claudeCodeCommand(ENDPOINT),
		`claude mcp add --transport http npmpro ${ENDPOINT} --header "Authorization: Bearer YOUR_TOKEN"`,
	);
});

it("desktopConfig is JSON that starts mcp-remote with the header and never holds a real token", () => {
	const text = desktopConfig(ENDPOINT);
	assert.deepEqual(JSON.parse(text), {
		mcpServers: {
			npmpro: {
				command: "npx",
				args: ["-y", "mcp-remote", ENDPOINT, "--header", `Authorization:${AUTH_HEADER_REF}`],
				env: { AUTH_HEADER: "Bearer YOUR_TOKEN" },
			},
		},
	});
	assert.ok(!text.includes("npmpro_"));
});

it("toolsByNeed groups by need and sorts the names", () => {
	const groups = toolsByNeed([
		{ name: "list_hosts", needs: "view" },
		{ name: "delete_host", needs: "delete" },
		{ name: "create_host", needs: "manage" },
		{ name: "get_audit_log", needs: "admin" },
		{ name: "get_host", needs: "view" },
		{ name: "odd", needs: "unknown" },
	]);
	assert.deepEqual(groups, {
		view: ["get_host", "list_hosts"],
		manage: ["create_host"],
		delete: ["delete_host"],
		admin: ["get_audit_log"],
	});
});

it("toolsByNeed of nothing has four empty groups", () => {
	assert.deepEqual(toolsByNeed([]), { view: [], manage: [], delete: [], admin: [] });
});

it("every need has its translation", () => {
	for (const need of NEEDS) assert.ok(en[`settings.api-access.mcp.needs.${need}`]);
});
