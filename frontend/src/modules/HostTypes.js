import { savedOf } from "./ApiError.js";
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
		expand: ["owner", "certificate", "dns_records"],
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
		expand: ["owner", "certificate", "dns_records"],
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
		expand: ["owner", "access_lists", "certificate", "dns_records"],
		noDirectory: "proxy-host.no-directory",
	},
};

// a proxy host also changes the counts of the access lists it uses
const accessLists = (type) => (type === "proxy" ? [["access-lists"]] : []);

// the names of proxy, redirection and 404 hosts feed the Keep updated suggestions of Dynamic DNS (streams have none)
const ddnsSuggestions = (type) => (type === "stream" ? [] : [["ddns-suggestions"]]);

// the server drops a host's DNS check when the host changes, is enabled, disabled or deleted (streams have none)
const dnsChecks = (type) => (type === "stream" ? [] : [["dns-check-hosts"]]);

// a host's save, enable, disable and delete change its record rows (made, paused, released): the plan of its names,
// the Dynamic DNS list and its status (streams have none)
const dnsRecords = (type) => (type === "stream" ? [] : [["dns-plan"], ["ddns-records"], ["ddns-status"]]);

export const toggleInvalidations = (type, id) => [
	[HOST_TYPES[type].listKey],
	[HOST_TYPES[type].itemKey, id],
	...dnsChecks(type),
	...dnsRecords(type),
];

export const deleteInvalidations = (type, id) => [
	...toggleInvalidations(type, id),
	["certificates"],
	...accessLists(type),
	...ddnsSuggestions(type),
];

export const saveInvalidations = (type, id) => [
	[HOST_TYPES[type].itemKey, id],
	[HOST_TYPES[type].listKey],
	["audit-logs"],
	["host-report"],
	["certificates"],
	...accessLists(type),
	...ddnsSuggestions(type),
	...dnsChecks(type),
	...dnsRecords(type),
];

// Adopt and update, Leave alone and Delete at the provider again change the host's record states, the Dynamic DNS list
// (its managed rows) and the audit log
export const dnsRecordInvalidations = (type, id) => [
	[HOST_TYPES[type].itemKey, id],
	[HOST_TYPES[type].listKey],
	...dnsChecks(type),
	["ddns-records"],
	["ddns-status"],
	["dns-plan"],
	["audit-logs"],
];

// a save that answered an error but is stored (nginx could not reload) changed the same caches as a successful one: the
// new host and a newly requested certificate must show in the lists and pickers even if the window is closed
export const saveErrorInvalidations = (type, err) => {
	const saved = savedOf(err);
	return saved ? saveInvalidations(type, saved.id) : [];
};
