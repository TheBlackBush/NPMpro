import net from "node:net";
import tls from "node:tls";

/**
 * A small SMTP server on 127.0.0.1 for the mail tests (node:net only; tlsOptions makes it an implicit-TLS server).
 * Modes: accept, rcpt-450, rcpt-550, auth-535-echo (the 535 reply echoes the password), auth-535-base64 (echoes its
 * base64), auth-535-url (a reply with URL credentials), drop (closes at once).
 * messages holds every received message raw; logins every AUTH as { user, password }.
 *
 * @param   {Object}  [options]
 * @param   {String}  [options.mode]
 * @param   {Object}  [options.tlsOptions]  key and cert: an implicit-TLS server
 * @returns {Promise<{port: Number, messages: String[], logins: Object[], close: Function}>}
 */
const startFakeSmtp = async ({ mode = "accept", tlsOptions } = {}) => {
	const messages = [];
	const logins = [];
	const sockets = new Set();

	const onConnection = (socket) => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
		socket.on("error", () => {});
		if (mode === "drop") {
			socket.destroy();
			return;
		}
		const send = (line) => socket.write(`${line}\r\n`);
		let buffer = "";
		let data = null;
		let loginStep = null;
		const finishAuth = (user, password) => {
			logins.push({ user, password });
			if (mode === "auth-535-echo") send(`535 5.7.8 Authentication failed for ${password}`);
			else if (mode === "auth-535-base64") send(`535 5.7.8 bad ${Buffer.from(password).toString("base64")}`);
			else if (mode === "auth-535-url")
				send("535 5.7.8 see https://admin:hunter22@example.com/help?token=abc123");
			else send("235 2.7.0 Authentication successful");
		};
		const command = (line) => {
			if (loginStep) {
				if (loginStep.user === null) {
					loginStep = { user: Buffer.from(line, "base64").toString() };
					send("334 UGFzc3dvcmQ6");
				} else {
					const { user } = loginStep;
					loginStep = null;
					finishAuth(user, Buffer.from(line, "base64").toString());
				}
				return;
			}
			const upper = line.toUpperCase();
			if (upper.startsWith("EHLO") || upper.startsWith("HELO")) {
				socket.write("250-fake.test\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n");
			} else if (upper.startsWith("AUTH PLAIN")) {
				const [, user, password] = Buffer.from(line.split(" ")[2] ?? "", "base64")
					.toString()
					.split("\0");
				finishAuth(user, password);
			} else if (upper.startsWith("AUTH LOGIN")) {
				loginStep = { user: null };
				send("334 VXNlcm5hbWU6");
			} else if (upper.startsWith("MAIL FROM")) {
				send("250 2.1.0 OK");
			} else if (upper.startsWith("RCPT TO")) {
				if (mode === "rcpt-450") send("450 4.2.1 mailbox busy");
				else if (mode === "rcpt-550") send("550 5.1.1 no such user");
				else send("250 2.1.5 OK");
			} else if (upper === "DATA") {
				data = "";
				send("354 go ahead");
			} else if (upper === "QUIT") {
				send("221 bye");
				socket.end();
			} else {
				send("250 OK");
			}
		};
		socket.on("data", (chunk) => {
			buffer += chunk.toString("latin1");
			while (true) {
				if (data !== null) {
					const end = buffer.indexOf("\r\n.\r\n");
					if (end === -1) return;
					messages.push(data + buffer.slice(0, end));
					data = null;
					buffer = buffer.slice(end + 5);
					send("250 2.0.0 queued");
				} else {
					const eol = buffer.indexOf("\r\n");
					if (eol === -1) return;
					const line = buffer.slice(0, eol);
					buffer = buffer.slice(eol + 2);
					command(line);
				}
			}
		});
		if (mode !== "drop") send("220 fake.test ESMTP");
	};

	const server = tlsOptions ? tls.createServer(tlsOptions, onConnection) : net.createServer(onConnection);
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	return {
		port: server.address().port,
		messages,
		logins,
		close: () =>
			new Promise((resolve) => {
				for (const socket of sockets) socket.destroy();
				server.close(resolve);
			}),
	};
};

export { startFakeSmtp };
