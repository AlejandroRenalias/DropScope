// Small shared controls of the run replay app: an icon button with a tooltip, and a keyboard hint.
import { Tooltip } from "@radix-ui/themes";
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";

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
