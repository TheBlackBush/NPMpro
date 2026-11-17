// Inlined into every landing page by build.js (identical in all eight, so one CSP hash allows it): shows the texts of
// the visitor's browser language (English is in the HTML already), shows the visit time as Settings, Landing pages
// chose (nginx writes UTC), fills the time chip when nginx did not, and holds the captcha form's callback.
(() => {
	const texts = JSON.parse(document.querySelector("#npmpro-texts").textContent);
	const wanted = [...(navigator.languages ?? []), navigator.language ?? ""];
	let code = "en";
	for (const tag of wanted) {
		const lower = String(tag).toLowerCase();
		const base = lower.split("-")[0];
		if (Object.hasOwn(texts, lower) || Object.hasOwn(texts, base)) {
			code = Object.hasOwn(texts, lower) ? lower : base;
			break;
		}
	}
	document.documentElement.lang = code;
	for (const element of document.querySelectorAll("[data-t]")) {
		const text = texts[code][element.dataset.t];
		if (text) element.textContent = text;
	}
	const time = document.querySelector("[data-npmpro-time]");
	if (time && time.textContent.trim() === "") {
		time.textContent = `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`;
	} else if (time) {
		const choice = time.dataset.visitTime;
		const moment = new Date(time.dataset.utc ?? "");
		if ((choice === "local" || choice === "local-utc") && !Number.isNaN(moment.getTime())) {
			try {
				const local = new Intl.DateTimeFormat(code, {
					year: "numeric",
					month: "short",
					day: "numeric",
					hour: "2-digit",
					minute: "2-digit",
					timeZoneName: "short",
				}).format(moment);
				// local-utc: the UTC time, with the UTC date (page's language, month short, day numeric) when the
				// visitor's date is another day
				const dayIn = (zone) =>
					new Intl.DateTimeFormat(code, {
						year: "numeric",
						month: "numeric",
						day: "numeric",
						...(zone ? { timeZone: zone } : {}),
					}).format(moment);
				const utcTime = moment.toISOString().slice(11, 16);
				const utcDate =
					dayIn() === dayIn("UTC")
						? ""
						: `${new Intl.DateTimeFormat(code, { month: "short", day: "numeric", timeZone: "UTC" }).format(moment)}, `;
				time.textContent = choice === "local" ? local : `${local} (${utcDate}${utcTime} UTC)`;
			} catch {
				// a browser without these options keeps nginx's UTC text
			}
		}
	}
	globalThis.captchaCallback = () => {
		setTimeout(() => document.querySelector("#captcha-form")?.submit(), 500);
	};
})();
