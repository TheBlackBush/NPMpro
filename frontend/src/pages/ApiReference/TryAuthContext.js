import { createContext } from "react";

/** The pasted API token of Try it, `{ token, setToken }`: React state of the page only, never stored anywhere */
export const TryAuthContext = createContext({ token: "", setToken: () => undefined });
