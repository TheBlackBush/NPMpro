import assert from "node:assert/strict";
import { it } from "node:test";
import { visibleNavItems } from "./Navigation.js";

const admin = { roles: ["admin"], permissions: {}, monitoring: true, goaccess: true };
const ids = (user) => visibleNavItems(user).map((item) => item.id);

it("an admin sees every link in order", () => {
	assert.deepEqual(ids(admin), [
		"dashboard",
		"proxy-hosts",
		"redirection-hosts",
		"dead-hosts",
		"streams",
		"certificates",
		"access-lists",
		"monitoring",
		"settings",
	]);
});

it("a user with view on proxy hosts only sees the dashboard and proxy hosts", () => {
	const user = { roles: [], permissions: { proxyHosts: "view", streams: "hidden" }, monitoring: true };
	assert.deepEqual(ids(user), ["dashboard", "proxy-hosts"]);
});

it("no Monitoring link when monitoring and GoAccess are off", () => {
	assert.ok(!ids({ ...admin, monitoring: false, goaccess: false }).includes("monitoring"));
});

it("GoAccess alone keeps the Monitoring link, pointing at /goaccess in a new tab", () => {
	const item = visibleNavItems({ ...admin, monitoring: false, goaccess: true }).find((i) => i.id === "monitoring");
	assert.deepEqual([item.to, item.external], ["/goaccess", true]);
});

it("no user yet (loading) shows only the dashboard", () => {
	assert.deepEqual(ids(undefined), ["dashboard"]);
});
