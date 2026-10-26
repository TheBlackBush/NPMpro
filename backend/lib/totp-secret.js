import { defaultSecretBox } from "./secret-box.js";

// TOTP secrets are stored encrypted with the secret box, like the other stored secrets. Rows from before are plaintext
// base32 and are encrypted on their next successful use (internal/totp.js verifyCode).

/**
 * @param   {String} secret  base32 TOTP secret
 * @returns {String}         the value to store
 */
const sealSecret = (secret) => defaultSecretBox.encrypt({ totp: secret });

/**
 * @param   {String} stored
 * @returns {Boolean}  true when the stored value is encrypted
 */
const isSealed = (stored) => String(stored).startsWith("v1:");

/**
 * @param   {String} stored  an encrypted value or a plaintext secret from before
 * @returns {String}         the base32 secret
 */
const openSecret = (stored) => (isSealed(stored) ? defaultSecretBox.decrypt(stored).totp : stored);

export { isSealed, openSecret, sealSecret };
