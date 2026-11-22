import { createKeyedLock } from "./keyed-lock.js";

// The lock of an owner's DNS domains. One owner never keeps a name on two credentials; the table has no owner column
// to hold that as an index (the owner is the credential's), so every change of an owner's domains (a domain or
// credential save, a backup restore or merge) checks before it writes and runs under that owner's lock. A leaf: the
// backup service takes it without loading the models.
const ownerLock = createKeyedLock();

/**
 * Runs fn under the locks of every owner the instance knows (a backup restore or merge, which may write the domains of
 * any owner). The locks are taken one after another in one order, so two of these never wait for each other in a
 * circle, and a save holds only its own owner's lock.
 *
 * @param   {Object}    knex
 * @param   {Function}  fn
 * @returns {Promise<*>}  what fn returns
 */
const withAllOwnerLocks = async (knex, fn) => {
	const users = await knex("user").pluck("id");
	const owners = await knex("npmpro_dns_credential").distinct("owner_user_id").pluck("owner_user_id");
	const keys = [...new Set([...users, ...owners].map(String))].sort((a, b) => a.localeCompare(b));
	const lockFrom = (index) => (index === keys.length ? fn() : ownerLock(keys[index], () => lockFrom(index + 1)));
	return await lockFrom(0);
};

export { ownerLock, withAllOwnerLocks };
