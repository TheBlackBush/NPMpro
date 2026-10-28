import { internalBackupSchedules } from "../internal/backup-service.js";
import { createScheduleRouter } from "../lib/express/backup-schedule-router.js";
import jwtdecode from "../lib/express/jwt-decode.js";

/**
 * /api/backups/schedules
 */
export default createScheduleRouter({ service: internalBackupSchedules, auth: jwtdecode });
