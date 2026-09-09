# Research Office robot asset

`robot-roles.svg` is an original, deterministic repo-native pixel-art sprite sheet authored for DropScope. It contains four transparent role variants—Commander, Evidence, Operations, and Safety—with distinct workstation equipment and shared neutral construction. Shapes are aligned to a crisp pixel grid and rendered with `image-rendering: pixelated` at the station sizes.

During this refactor, the built-in ImageGen tool was used first to explore a genuinely transparent sprite-sheet direction. The generated result was inspected successfully for alpha transparency, but was not copied into production because this workstream is constrained to the existing SVG asset path and the UI needs deterministic, inspectable source art. The final production asset is therefore the hand-authored SVG above; no external or copied artwork is used.
