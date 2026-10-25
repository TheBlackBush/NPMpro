import { createSerializer } from "./monitoring-update.js";

/**
 * The runtime settings queue: runtime saves, the Cloudflare refresh, the access log switch, the certificate delete
 * guard, host config writes (internalNginx.configure and removeConfig) and the stapling recovery run in it one after
 * another, so a save's nginx -t and restore never interleave with another config write and host renders read the
 * effective values of the last finished save. A job must never wait for another job of the queue (it would wait for
 * itself): work it starts for later (the stapling recovery after an OCSP fetch) is queued without being awaited.
 */
const runtimeQueue = createSerializer();

/**
 * Runs fn in the runtime settings queue
 *
 * @param   {Function}  fn
 * @returns {Promise<*>}
 */
const runtimeExclusive = (fn) => runtimeQueue(fn);

export { runtimeExclusive, runtimeQueue };
