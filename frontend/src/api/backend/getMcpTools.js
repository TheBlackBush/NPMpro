import * as api from "./base";

export async function getMcpTools() {
	return await api.get({
		url: "/mcp/tools",
	});
}
