import { ClockCounterClockwise } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { useEffect } from "react";
import { RunScreen } from "./replay-screen.js";

/** The default screen: the agent run replay, with a secondary entry to the legacy mission simulator. */
export function RunsApp() {
  // A link to a section scrolls to it but leaves the focus behind: when the skip link is followed, move the focus there too.
  useEffect(() => {
    const follow = () => {
      if (window.location.hash === "#rr-timeline") document.getElementById("rr-timeline")?.focus({ preventScroll: true });
    };
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);
  return (
    <div className="app runs-app">
      <a className="skip-link" href="#rr-timeline">
        Skip to the timeline
      </a>
      <header className="topbar">
        <div className="topbar-row">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true" />
            <span className="brand-name">DropScope</span>
            <em>Agent run forensics</em>
          </div>
          <nav className="workspace-nav runs-nav" aria-label="Primary navigation">
            <a className="active" href="#main" aria-current="page">
              <span className="nav-icon" aria-hidden="true">
                <ClockCounterClockwise size={17} weight="fill" />
              </span>
              <span className="nav-label">Run replay</span>
            </a>
          </nav>
          <div className="topbar-spacer" />
          <a className="legacy-link" href="#missions">
            <span className="short">Legacy simulator</span>
            <span className="long">Mission simulator (legacy)</span>
          </a>
        </div>
      </header>
      <main className="content runs-content" id="main">
        <RunScreen />
      </main>
    </div>
  );
}
