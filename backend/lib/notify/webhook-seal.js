import { defaultSecretBox } from "../secret-box.js";

/**
 * The one way a webhook's URL or secret becomes a database value: the text, sealed. The webhook service (create, update,
 * rotate) and a backup restore or merge (with the target's box) all write these columns through it.
 *
 * @param   {String}  text
 * @param   {{encrypt: Function}}  [box]  the secret box of the database that stores the value
 * @returns {String}
 */
const sealWebhookText = (text, box = defaultSecretBox) => box.encrypt(String(text));

export { sealWebhookText };
