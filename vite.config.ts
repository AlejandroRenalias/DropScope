import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// DROPSCOPE_BASE lets a static host serve the build from a sub-path (for example /DropScope/).
export default defineConfig({ base: process.env.DROPSCOPE_BASE ?? "/", plugins: [react()] });
