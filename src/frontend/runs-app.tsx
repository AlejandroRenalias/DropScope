import { ClockCounterClockwise } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { RunScreen } from "./replay-screen.js";

/** The default screen: the agent run replay, with a secondary entry to the legacy mission simulator. */
export function RunsApp() {
  return <div className="app runs-app">
    <header className="topbar">
      <div className="topbar-row">
        <div className="brand"><span className="brand-mark" aria-hidden="true" /><span className="brand-name">DropScope</span><em>Agent run forensics</em></div>
        <nav className="workspace-nav runs-nav" aria-label="Primary navigation">
          <a className="active" href="#" aria-current="page"><span className="nav-icon" aria-hidden="true"><ClockCounterClockwise size={17} weight="fill" /></span><span className="nav-label">Run replay</span></a>
        </nav>
        <div className="topbar-spacer" />
        <a className="legacy-link" href="#missions"><span className="short">Legacy simulator</span><span className="long">Mission simulator (legacy)</span></a>
      </div>
    </header>
    <main className="content runs-content" id="main">
      <RunScreen />
    </main>
  </div>;
}
