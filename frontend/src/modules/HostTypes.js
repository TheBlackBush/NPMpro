import { DEAD_HOSTS, PROXY_HOSTS, REDIRECTION_HOSTS, STREAMS } from "./Permissions.js";

// The four host types of the lists and windows: names, query keys, expand lists, and the caches each change
// refreshes. Pure, so the unit tests pin every invalidation list. section is also the permission section.
export const HOST_TYPES = {
	dead: {
		object: "dead-host",
		objects: "dead-hosts",
		section: DEAD_HOSTS,
		listKey: "dead-hosts",
		itemKey: "dead-host",
		kind: "dead_hosts",
		help: "DeadHosts",
		expand: ["owner", "certificate"],
		noDirectory: "dead-host.no-directory",
	},
	redirection: {
		object: "redirection-host",
		objects: "redirection-hosts",
		section: REDIRECTION_HOSTS,
		listKey: "redirection-hosts",
		itemKey: "redirection-host",
		kind: "redirection_hosts",
		help: "RedirectionHosts",
		expand: ["owner", "certificate"],
		noDirectory: "redirection-host.no-directory",
	},
	stream: {
		object: "stream",
		objects: "streams",
		section: STREAMS,
		listKey: "streams",
		itemKey: "stream",
		kind: "streams",
		help: "Streams",
		expand: ["owner", "certificate"],
		noDirectory: "stream.no-directory",
	},
	proxy: {
		object: "proxy-host",
		objects: "proxy-hosts",
		section: PROXY_HOSTS,
		listKey: "proxy-hosts",
		itemKey: "proxy-host",
		kind: "proxy_hosts",
		help: "ProxyHosts",
		expand: ["owner", "access_lists", "certificate"],
		noDirectory: "proxy-host.no-directory",
	},
};

// a proxy host also changes the counts of the access lists it uses
const accessLists = (type) => (type === "proxy" ? [["access-lists"]] : []);

export const toggleInvalidations = (type, id) => [[HOST_TYPES[type].listKey], [HOST_TYPES[type].itemKey, id]];

export const deleteInvalidations = (type, id) => [
	...toggleInvalidations(type, id),
	["certificates"],
	...accessLists(type),
];

export const saveInvalidations = (type, id) => [
	[HOST_TYPES[type].itemKey, id],
	[HOST_TYPES[type].listKey],
	["audit-logs"],
	["host-report"],
	["certificates"],
	...accessLists(type),
];
