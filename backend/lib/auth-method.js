/**
 * Auth method a session was created with. Tokens issued before this field existed count as "password".
 *
 * @param   {Object} [attrs] token attrs
 * @returns {"oidc"|"password"}
 */
export const carryAuthMethod = (attrs) => (attrs?.auth_method === "oidc" ? "oidc" : "password");

export default { carryAuthMethod };
