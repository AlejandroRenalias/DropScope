// Small shared controls of the run replay app: an icon button with a tooltip, and a keyboard hint.
import { Tooltip } from "@radix-ui/themes";
import { forwardRef, useEffect, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";

type IconButtonProps = ComponentPropsWithoutRef<"button"> & {
  /** The button's name. It is also the tooltip, so the name a screen reader hears is the text a pointer user sees. */
  label: string;
  /** A keyboard shortcut shown in the tooltip only. */
  shortcut?: string;
  children: ReactNode;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, shortcut, children, className, ...rest },
  ref,
) {
  return (
    <Tooltip
      content={
        <span className="ds-tip">
          {label}
          {shortcut && <kbd>{shortcut}</kbd>}
        </span>
      }
      delayDuration={350}
    >
      <button ref={ref} type="button" aria-label={label} className={`ds-icon-btn ${className ?? ""}`} {...rest}>
        {children}
      </button>
    </Tooltip>
  );
});

/** Whether a media query matches, kept up to date. The layout breakpoints in run-replay.css use the same values. */
export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;
    const sync = () => setMatch(list.matches);
    sync();
    list.addEventListener("change", sync);
    return () => list.removeEventListener("change", sync);
  }, [query]);
  return match;
}

export const PHONE = "(max-width: 759px)";
export const TABLET = "(min-width: 760px) and (max-width: 1279px)";
