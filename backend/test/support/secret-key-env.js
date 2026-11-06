import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Import this first: lib/secret-box.js reads the key file path when it loads, and a test must never create the key
// under /data. The test file removes the folder in an `after` hook.
process.env.NPMPRO_SECRET_KEY_FILE ??= path.join(mkdtempSync(path.join(os.tmpdir(), "npmpro-key-")), "dns.key");
