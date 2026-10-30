import { tlsQueriesSettled } from "src/modules/HostForms";
import { useCertificates } from "./useCertificates";
import { useDnsProviders } from "./useDnsProviders";
import { useUser } from "./useUser";

/**
 * Whether the reads of a host window's TLS tab have settled (HostForms.js tlsQueriesSettled), on the query keys the
 * fields use, so nothing is fetched twice
 *
 * @returns {boolean}
 */
const useTlsQueriesSettled = () => {
	const user = useUser("me");
	const certificates = useCertificates();
	const dnsProviders = useDnsProviders();
	return tlsQueriesSettled({ user, certificates, dnsProviders });
};

export { useTlsQueriesSettled };
