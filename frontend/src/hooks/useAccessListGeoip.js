import { useQuery } from "@tanstack/react-query";
import { getAccessListGeoip } from "src/api/backend";

const useAccessListGeoip = () =>
	useQuery({
		queryKey: ["access-lists", "geoip"],
		queryFn: () => getAccessListGeoip(),
		staleTime: 30 * 1000,
	});

export { useAccessListGeoip };
