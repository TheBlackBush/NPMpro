import { version as tablerVersion } from "@tabler/core/package.json";
import { IconBrandGithub } from "@tabler/icons-react";
import { useCheckVersion } from "src/hooks";
import { T } from "src/locale";

const repoUrl = "https://github.com/TheBlackBush/NPMpro";
// release builds are "<MAJOR.MINOR.PATCH>-<commit>", beta and develop builds end with "-<commit>"
const releaseBuildPattern = /^(?<release>\d+\.\d+\.\d+)-[0-9a-f]+$/u;
const commitPattern = /-(?<commit>[0-9a-f]+)$/u;

// One item per line on phones, a dot separated row from sm up (Tabler's own dots would start wrapped lines).
function Item({ first = false, children }) {
	return (
		<li className="list-inline-item d-block d-sm-inline-block">
			{first ? null : (
				<span className="d-none d-sm-inline me-2" aria-hidden="true">
					·
				</span>
			)}
			{children}
		</li>
	);
}

export function SiteFooter() {
	const { data: versionData } = useCheckVersion();

	const version = versionData?.current || "";
	const release = releaseBuildPattern.exec(version)?.groups.release;
	const commit = commitPattern.exec(version)?.groups.commit;
	const versionUrl = release ? `${repoUrl}/releases/tag/v${release}` : commit ? `${repoUrl}/tree/${commit}` : repoUrl;

	return (
		<footer className="footer d-print-none py-3">
			<div className="container-xl">
				<div className="row text-center align-items-center flex-row-reverse">
					<div className="col-lg-auto ms-lg-auto">
						<ul className="list-inline mb-0">
							<li className="list-inline-item">
								<a href={repoUrl} target="_blank" className="link-secondary" rel="noopener">
									<IconBrandGithub className="icon icon-inline me-1" aria-hidden="true" />
									<T id="footer.github" />
								</a>
							</li>
						</ul>
					</div>
					<div className="col-12 col-lg-auto mt-3 mt-lg-0 d-lg-flex gap-lg-3">
						<ul className="list-inline mb-0">
							<Item first>
								<a
									href="https://github.com/TheBlackBush"
									rel="noreferrer"
									target="_blank"
									className="link-secondary"
								>
									NPMpro by TheBlackBush
								</a>
							</Item>
							<Item>
								<a
									href="https://github.com/ZoeyVid/NPMplus"
									rel="noreferrer"
									target="_blank"
									className="link-secondary"
								>
									NPMplus by ZoeyVid
								</a>
							</Item>
							<Item>
								<a href="https://jc21.com" rel="noreferrer" target="_blank" className="link-secondary">
									jc21.com
								</a>
							</Item>
							<Item>
								Theme by{" "}
								<a href="https://tabler.io" rel="noreferrer" target="_blank" className="link-secondary">
									Tabler
								</a>{" "}
								({tablerVersion})
							</Item>
						</ul>
						<ul className="list-inline mb-0 mt-2 mt-lg-0">
							<Item first>© {new Date().getFullYear()} AGPL-3.0 (and MIT)</Item>
							<Item>
								<a href={versionUrl} className="link-secondary" target="_blank" rel="noopener">
									{version}
								</a>
							</Item>
							{versionData?.updateAvailable && (
								<Item>
									<a
										href={`${repoUrl}/releases/tag/${versionData.latest}`}
										className="link-warning fw-bold"
										target="_blank"
										rel="noopener"
										title={`New version ${versionData.latest} is available`}
									>
										<T id="update-available" data={{ latestVersion: versionData.latest }} />
									</a>
								</Item>
							)}
						</ul>
					</div>
				</div>
			</div>
		</footer>
	);
}
