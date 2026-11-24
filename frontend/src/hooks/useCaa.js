import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { checkCaa, getCertificateCaa } from "src/api/backend";
import { CAA_DEBOUNCE_MS } from "src/modules/Caa";

/**
 * The CAA check of a window's names: asks CAA_DEBOUNCE_MS after the request last changed. The previous answer stays
 * until the new one arrives (no flicker while typing), then it is replaced; nothing shows while there is nothing to
 * ask. A failed check answers nothing: the note is a help, never a block.
 *
 * @param   {Object|null} request  caaRequest of the window; null: nothing to ask
 * @returns {{ names: Array, checkedOn: string }|undefined}
 */
const useCaaCheck = (request) => {
	const key = request === null ? null : JSON.stringify(request);
	const [settled, setSettled] = useState(null);
	useEffect(() => {
		if (key === null) {
			setSettled(null);
			return;
		}
		const timer = setTimeout(() => setSettled(key), CAA_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [key]);
	const { data } = useQuery({
		queryKey: ["caa-check", settled],
		queryFn: () => checkCaa(JSON.parse(settled)),
		enabled: settled !== null,
		staleTime: 30 * 1000,
		retry: false,
		refetchOnWindowFocus: false,
		placeholderData: keepPreviousData,
	});
	return key === null ? undefined : data;
};

// the cached results of the certificates (the server keeps them in memory and refreshes a few old ones per call): the
// list reads them after it has loaded (a certificate change invalidates the "certificates" queries, this one too), a
// failure shows no badge
const CERTIFICATE_CAA_KEY = ["certificates", "caa"];

const useCertificateCaa = () =>
	useQuery({
		queryKey: CERTIFICATE_CAA_KEY,
		queryFn: getCertificateCaa,
		staleTime: 60 * 1000,
		retry: false,
	});

export { useCaaCheck, useCertificateCaa };
