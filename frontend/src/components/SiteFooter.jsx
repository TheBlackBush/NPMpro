import { version as tablerVersion } from "@tabler/core/package.json";
import { IconBrandGithub } from "@tabler/icons-react";
import { useCheckVersion } from "src/hooks";
import { T } from "src/locale";

const repoUrl = "https://github.com/TheBlackBush/NPMpro";
// release builds are "<MAJOR.MINOR.PATCH>-<commit>", beta and develop builds end with "-<commit>"
const releaseBuildPattern = /^(?<release>\d+\.\d+\.\d+)-[0-9a-f]+$/u;
const commitPattern = /-(?<commit>[0-9a-f]+)$/u;

// Inline dotted list from md up, plain stacked list below (Tabler's dots would start wrapped lines).
function Group({ items, className = "" }) {
	return (
		<div className={className}>
			<ul className="list-inline list-inline-dots mb-0 d-none d-md-block">
				{items.map(([key, node]) => (
					<li key={key} className="list-inline-item">
						{node}
					</li>
				))}
			</ul>
			<ul className="list-unstyled mb-0 d-md-none">
				{items.map(([key, node]) => (
					<li key={key}>{node}</li>
				))}
			</ul>
		</div>
	);
}

export function SiteFooter() {
	const { data: versionData } = useCheckVersion();

	const version = versionData?.current || "";
	const release = releaseBuildPattern.exec(version)?.groups.release;
	const commit = commitPattern.exec(version)?.groups.commit;
	const versionUrl = release ? `${repoUrl}/releases/tag/v${release}` : commit ? `${repoUrl}/tree/${commit}` : repoUrl;

	const credits = [
		[
			"npmpro",
			<a
				key="a"
				href="https://github.com/TheBlackBush"
				rel="noreferrer"
				target="_blank"
				className="link-secondary"
			>
				NPMpro by TheBlackBush
			</a>,
		],
		[
			"npmplus",
			<a
				key="a"
				href="https://github.com/ZoeyVid/NPMplus"
				rel="noreferrer"
				target="_blank"
				className="link-secondary"
			>
				NPMplus by ZoeyVid
			</a>,
		],
		[
			"jc21",
			<a key="a" href="https://jc21.com" rel="noreferrer" target="_blank" className="link-secondary">
				jc21.com
			</a>,
		],
		[
			"tabler",
			<>
				Theme by{" "}
				<a href="https://tabler.io" rel="noreferrer" target="_blank" className="link-secondary">
					Tabler
				</a>{" "}
				({tablerVersion})
			</>,
		],
	];
	const meta = [
		["copyright", <>© {new Date().getFullYear()} AGPL-3.0 (and MIT)</>],
		[
			"version",
			<a key="a" href={versionUrl} className="link-secondary" target="_blank" rel="noopener">
				{version}
			</a>,
		],
	];
	if (versionData?.updateAvailable) {
		meta.push([
			"update",
			<a
				key="a"
				href={`${repoUrl}/releases/tag/${versionData.latest}`}
				className="link-warning fw-bold"
				target="_blank"
				rel="noopener"
				title={`New version ${versionData.latest} is available`}
			>
				<T id="update-available" data={{ latestVersion: versionData.latest }} />
			</a>,
		]);
	}

	return (
		<footer className="footer d-print-none py-3">
			<div className="container-xl">
				<div className="row text-center align-items-center flex-row-reverse">
					<div className="col-lg-auto ms-lg-auto">
						<a href={repoUrl} target="_blank" className="link-secondary" rel="noopener">
							<IconBrandGithub className="icon icon-inline me-1" aria-hidden="true" />
							<T id="footer.github" />
						</a>
					</div>
					<div className="col-12 col-lg-auto mt-3 mt-lg-0 d-lg-flex gap-lg-3">
						<Group items={credits} />
						<Group items={meta} className="mt-2 mt-lg-0" />
					</div>
				</div>
			</div>
		</footer>
	);
}
