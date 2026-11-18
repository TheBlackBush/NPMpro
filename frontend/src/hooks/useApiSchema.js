import { useQuery } from "@tanstack/react-query";
import { getApiSchema } from "src/api/backend";

const useApiSchema = () =>
	useQuery({
		queryKey: ["api-schema"],
		queryFn: getApiSchema,
		staleTime: Number.POSITIVE_INFINITY,
		retry: 1,
	});

export { useApiSchema };
