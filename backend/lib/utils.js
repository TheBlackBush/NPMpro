import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import { Liquid } from "liquidjs";
import { global as logger } from "../logger.js";
import errs from "./error.js";

const nodeExecFilePromises = promisify(nodeExecFile);

/**
 * @param   {String} cmd
 * @param   {Array}  args
 * @param   {Object} [options]          node:child_process execFile options
 * @param   {number} [options.timeout]  ms, the process is killed (SIGTERM) after it
 * @returns {Promise}
 */
const execFile = async (cmd, args, options = {}) => {
	logger.debug(`CMD: ${cmd} ${args ? args.join(" ") : ""}`);

	try {
		const { stdout, stderr } = await nodeExecFilePromises(cmd, args, options);
		return `${stdout || ""}${stderr || ""}`.trim();
	} catch (err) {
		throw new errs.CommandError(`${err.stdout || ""}${err.stderr || ""}`.trim(), { cause: err });
	}
};

// Parsed templates only, cached by file name by liquidjs, partials included. They ship in the image, so they cannot go
// stale, and nothing rendered is kept.
const renderEngine = new Liquid({
	root: `${import.meta.dirname}/../templates/`,
	cache: true,
});

// expects an object with the properties directive and address
renderEngine.registerFilter("nginxAccessRule", (v) => {
	if (v.directive && v.address) return `${v.directive} ${v.address};`;
	return "";
});

const getRenderEngine = () => renderEngine;

/**
 * @param   {String}  name   a file in templates/
 * @param   {Object}  scope
 * @returns {Promise<String>}
 */
const renderTemplate = (name, scope) => renderEngine.renderFile(name, scope);

export default { execFile, getRenderEngine, renderTemplate };
