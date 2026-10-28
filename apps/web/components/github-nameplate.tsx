import Link from "next/link";
import { SupportAuthorLink } from "./support-author-link";

/** Small open-source nameplate at the bottom of every app page's main column
 *  (search / library, show detail, activity, notifications, settings) — a quiet
 *  暗记 + CTA: "this is open source, here's the repo", plus the tip link. Shows on
 *  both demo and self-hosted (demo visitors are potential self-hosters too). No star
 *  count (new repo, thin numbers look bleak) — just the GitHub mark + a one-line
 *  pitch. It sits after the page content, outside any in-page Suspense boundary (like
 *  Settings, where it has always shown while sections stream in); only the route-level
 *  loading shells (the empty `aria-busy` main) leave it out. */
export function GitHubNameplate() {
  return (
    <footer className="github-nameplate">
      <Link
        href="https://github.com/QFgood/mediary-scout-o0521"
        target="_blank"
        rel="noopener noreferrer"
        className="github-nameplate-link"
      >
        {/* GitHub mark (simplified inline SVG so we don't pull a brand-icon
            dependency; used here only as a link attribution marker). */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          aria-hidden
          fill="currentColor"
          style={{ flex: "0 0 auto" }}
        >
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
        <span className="github-nameplate-text">
          Mediary Scout · 开源自部署 · <span className="github-nameplate-cta">GitHub →</span>
        </span>
      </Link>
      <SupportAuthorLink />
    </footer>
  );
}
