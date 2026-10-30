import { useState } from "react";
import { tlsQueriesSettled } from "src/modules/HostForms";
import { useCertificates } from "./useCertificates";
import { useDnsProviders } from "./useDnsProviders";
import { useUser } from "./useUser";

/**
 * Whether the reads of a host window's TLS tab have settled (HostForms.js tlsQueriesSettled), on the query keys the
 * fields use, so nothing is fetched twice; the proxy host window passes its access-list read too. It gates the first
 * mount of the window's form only: once true it stays true for the life of the component, as a refetch (window focus,
 * a new observer) puts an errored read back to pending and a user that loads later can make the certificates or the
 * access lists count again; a live condition would unmount the open form and drop the user's changes. Do not use it
 * as a live condition.
 *
 * @param   {Object} [options]
 * @param   {Object} [options.accessLists]  the window's useAccessLists(...) result, on the key its fields use
 * @returns {boolean}
 */
const useTlsQueriesSettled = ({ accessLists } = {}) => {
	const user = useUser("me");
	const certificates = useCertificates();
	const dnsProviders = useDnsProviders();
	const settled = tlsQueriesSettled({ user, certificates, dnsProviders, accessLists });
	// state, not a ref: React's documented way to keep what an earlier render saw (a ref must not be written during
	// render); the update during render re-renders this component at once, before its children
	const [latched, setLatched] = useState(false);
	if (settled && !latched) setLatched(true);
	return latched || settled;
};

export { useTlsQueriesSettled };
