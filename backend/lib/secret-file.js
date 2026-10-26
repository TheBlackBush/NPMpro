import { chmod, chown, writeFile } from "node:fs/promises";

// the nginx workers' group when the container runs as root (start.sh, Dockerfile npmpro-worker)
const WORKER_GID = 101;

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
	if (workerReadable && process.getuid?.() === 0) {
		await chown(file, 0, WORKER_GID);
		await chmod(file, 0o640);
		return;
	}
	await chmod(file, 0o600);
};

export { writeSecretFile };
