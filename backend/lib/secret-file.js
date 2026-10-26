import { chmod, chown, writeFile } from "node:fs/promises";

// the unprivileged nginx workers' group, set by start.sh only when the workers run as npmpro-worker
const workerGid = () => {
	const gid = Number.parseInt(process.env.NPMPRO_NGINX_WORKER_GID ?? "", 10);
	return Number.isInteger(gid) && gid > 0 ? gid : null;
};

/**
 * Writes a file only its owner may read (private keys, htpasswd): 0600 at creation, and again when the file existed
 * (the mode option of writeFile only applies to a new file). With workerReadable, the nginx workers may read it too.
 *
 * @param   {String}         file
 * @param   {String|Buffer}  content
 * @param   {Object}         [options]
 * @param   {Boolean}        [options.workerReadable]  root: owner root, group npmpro-worker, 0640
 * @returns {Promise}
 */
const writeSecretFile = async (file, content, { workerReadable = false } = {}) => {
	await writeFile(file, content, { encoding: "utf8", mode: 0o600 });
	// as root the nginx workers run as another user: a file they read per request (htpasswd) gets their group
	if (workerReadable && workerGid() !== null) {
		await chown(file, 0, workerGid());
		await chmod(file, 0o640);
		return;
	}
	await chmod(file, 0o600);
};

export { workerGid, writeSecretFile };
