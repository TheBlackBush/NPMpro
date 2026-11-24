import { useMutation } from "@tanstack/react-query";
import { testDnsCredential } from "src/api/backend";

// a test reads at the provider and stores nothing: no query key changes
const useTestDnsCredential = () => useMutation({ mutationFn: (id) => testDnsCredential(id) });

export { useTestDnsCredential };
