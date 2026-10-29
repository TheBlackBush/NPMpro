import internalDatabase from "../internal/database-service.js";
import { createDatabaseRouter } from "../lib/express/database-router.js";
import jwtdecode from "../lib/express/jwt-decode.js";

/**
 * /api/database
 */
export default createDatabaseRouter({ service: internalDatabase, auth: jwtdecode });
