export const createSchema = async (knex) => {
	const hostTable = (name, extra = () => {}) =>
		knex.schema.createTable(name, (t) => {
			t.increments("id");
			t.integer("owner_user_id").notNull().defaultTo(1);
			t.json("domain_names").notNull().defaultTo("[]");
			t.integer("enabled").notNull().defaultTo(1);
			t.integer("certificate_id").notNull().defaultTo(0);
			t.json("meta").notNull().defaultTo("{}");
			t.integer("npmpro_nginx_online").notNull().defaultTo(1);
			t.text("npmpro_nginx_err").notNull().defaultTo("");
			t.dateTime("created_on").nullable();
			t.dateTime("modified_on").nullable();
			extra(t);
		});
	await knex.schema.createTable("user", (t) => {
		t.increments("id");
		t.string("email").notNull();
		t.string("name").notNull();
		t.json("roles").notNull();
		t.string("avatar").notNull().defaultTo("");
		t.integer("npmpro_token_valid_after").notNull().defaultTo(0);
		t.integer("is_disabled").notNull().defaultTo(0);
	});
	await knex.schema.createTable("auth", (t) => {
		t.increments("id");
		t.integer("user_id").notNull();
		t.string("type").notNull();
		t.string("secret").notNull();
		t.json("meta").notNull();
	});
	await knex.schema.createTable("user_permission", (t) => {
		t.increments("id");
		t.integer("user_id").notNull();
		t.string("visibility").notNull();
	});
	await hostTable("proxy_host", (t) => {
		t.integer("npmpro_mtls_certificate_id").notNull().defaultTo(0);
		t.integer("access_list_id").notNull().defaultTo(0);
	});
	await hostTable("redirection_host");
	await hostTable("dead_host");
	await knex.schema.createTable("stream", (t) => {
		t.increments("id");
		t.integer("owner_user_id").notNull().defaultTo(1);
		t.string("incoming_port").notNull().defaultTo("");
		t.integer("enabled").notNull().defaultTo(1);
		t.integer("npmpro_nginx_online").notNull().defaultTo(1);
		t.text("npmpro_nginx_err").notNull().defaultTo("");
		t.integer("certificate_id").notNull().defaultTo(0);
		t.json("meta").notNull().defaultTo("{}");
		t.integer("tcp_forwarding").notNull().defaultTo(1);
		t.integer("udp_forwarding").notNull().defaultTo(0);
	});
	await knex.schema.createTable("npmpro_location", (t) => {
		t.increments("id");
		t.integer("proxy_host_id").notNull();
		t.text("path").notNull();
	});
	await knex.schema.createTable("npmpro_proxy_host_access_list", (t) => {
		t.integer("proxy_host_id").notNull();
		t.integer("location_id").notNull().defaultTo(0);
		t.integer("access_list_id").notNull();
		t.primary(["proxy_host_id", "location_id", "access_list_id"]);
	});
	await knex.schema.createTable("certificate", (t) => {
		t.increments("id");
		t.integer("owner_user_id").notNull().defaultTo(1);
		t.string("provider").notNull();
		t.string("nice_name").notNull().defaultTo("");
		t.json("domain_names").notNull().defaultTo("[]");
		t.json("meta").notNull().defaultTo("{}");
		t.integer("npmpro_dns_credential_id").nullable();
	});
	await knex.schema.createTable("access_list", (t) => {
		t.increments("id");
		t.integer("owner_user_id").notNull().defaultTo(1);
		t.string("name").notNull();
		t.json("meta").notNull().defaultTo("{}");
	});
	for (const table of ["access_list_auth", "access_list_client"]) {
		await knex.schema.createTable(table, (t) => {
			t.increments("id");
			t.integer("access_list_id").notNull();
			t.string("value").notNull().defaultTo("");
			t.string("username").notNull().defaultTo("");
			t.string("password").notNull().defaultTo("");
			t.json("meta").notNull().defaultTo("{}");
		});
	}
	await knex.schema.createTable("npmpro_dns_credential", (t) => {
		t.increments("id");
		t.integer("owner_user_id").notNull().defaultTo(1);
		t.string("name").notNull();
		t.text("values").notNull();
	});
	await knex.schema.createTable("setting", (t) => {
		t.string("id").primary();
		t.string("name").notNull().defaultTo("");
		t.json("meta").notNull().defaultTo("{}");
	});
	await knex("user").insert({ id: 1, email: "admin@example.com", name: "Admin", roles: '["admin"]' });
	await knex("auth").insert({ id: 1, user_id: 1, type: "password", secret: "admin-hash", meta: "{}" });
	await knex("user_permission").insert({ id: 1, user_id: 1, visibility: "all" });
};
