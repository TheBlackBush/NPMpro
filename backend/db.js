import knex from "knex";
import { configGet } from "./lib/config.js";

let instance = null;

const getInstance = () => {
	instance ??= knex(configGet("database").knex);
	return instance;
};

export default getInstance;
