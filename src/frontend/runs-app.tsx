import { Theme } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import { RunScreen } from "./replay-screen.js";

type Appearance = "light" | "dark";
const THEME_KEY = "dropscope.theme";

// The chosen theme is a convenience of this browser only. Storage can be missing (a private window, blocked site data), so every access is guarded.
function storedTheme(): Appearance | null {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function useSystemTheme(): Appearance {
  const query = "(prefers-color-scheme: dark)";
  const [dark, setDark] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;
    const sync = () => setDark(list.matches);
    list.addEventListener("change", sync);
    return () => list.removeEventListener("change", sync);
  }, []);
  return dark ? "dark" : "light";
}

/** The default screen: the agent run replay, with a secondary entry to the legacy mission simulator. */
export function RunsApp() {
  const system = useSystemTheme();
  const [chosen, setChosen] = useState<Appearance | null>(storedTheme);
  const theme = chosen ?? system;

  // The tokens hang on the root element so that popovers, which render outside this tree, get them too.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.dsTheme = theme;
    root.style.colorScheme = theme;
    return () => {
      delete root.dataset.dsTheme;
      root.style.colorScheme = "";
    };
  }, [theme]);

  // A link to a section scrolls to it but leaves the focus behind: when the skip link is followed, move the focus there too.
  useEffect(() => {
    const follow = () => {
      if (window.location.hash === "#rr-timeline") document.getElementById("rr-timeline")?.focus({ preventScroll: true });
    };
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);

  const toggle = () => {
    const next: Appearance = theme === "dark" ? "light" : "dark";
    setChosen(next);
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // The choice then lasts until the page is closed.
    }
  };

  return (
    <Theme appearance={theme} accentColor="blue" grayColor="gray" radius="small" hasBackground={false}>
      <div className="ds runs-app">
        <a className="skip-link" href="#rr-timeline">
          Skip to the timeline
        </a>
        <RunScreen theme={theme} onToggleTheme={toggle} />
      </div>
    </Theme>
  );
}
