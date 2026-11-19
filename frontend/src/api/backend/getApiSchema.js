// The compiled OpenAPI schema as the server sends it. It does not go through base.js: that one converts the keys to
// camelCase (the schema's keys are names of routes and fields) and signs the user out on a 401.
export async function getApiSchema() {
	const response = await fetch("/api/schema", {
		credentials: "same-origin",
		headers: { Accept: "application/json" },
	});
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}`);
	}
	return response.json();
}
