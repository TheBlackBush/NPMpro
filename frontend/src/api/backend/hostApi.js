import * as api from "./base";

// The six requests of a host type under /nginx/<path>: the list, one host, create, update, delete, enable or disable
function hostApi(path) {
	const url = `/nginx/${path}`;
	return {
		getAll: async (expand, params = {}) => await api.get({ url, params: { expand: expand?.join(","), ...params } }),
		get: async (id, expand, params = {}) =>
			await api.get({ url: `${url}/${id}`, params: { expand: expand?.join(","), ...params } }),
		create: async (item) => await api.post({ url, data: item }),
		update: async (item) => {
			// the id goes into the path, not the body
			const { id, ...data } = item;
			return await api.put({ url: `${url}/${id}`, data });
		},
		remove: async (id) => await api.del({ url: `${url}/${id}` }),
		toggle: async (id, enabled) => await api.post({ url: `${url}/${id}/${enabled ? "enable" : "disable"}` }),
	};
}

export const {
	getAll: getDeadHosts,
	get: getDeadHost,
	create: createDeadHost,
	update: updateDeadHost,
	remove: deleteDeadHost,
	toggle: toggleDeadHost,
} = hostApi("dead-hosts");
export const {
	getAll: getRedirectionHosts,
	get: getRedirectionHost,
	create: createRedirectionHost,
	update: updateRedirectionHost,
	remove: deleteRedirectionHost,
	toggle: toggleRedirectionHost,
} = hostApi("redirection-hosts");
export const {
	getAll: getProxyHosts,
	get: getProxyHost,
	create: createProxyHost,
	update: updateProxyHost,
	remove: deleteProxyHost,
	toggle: toggleProxyHost,
} = hostApi("proxy-hosts");
export const {
	getAll: getStreams,
	get: getStream,
	create: createStream,
	update: updateStream,
	remove: deleteStream,
	toggle: toggleStream,
} = hostApi("streams");
