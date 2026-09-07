import { mkdir, readFile, appendFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { missionEventSchema, type MissionEvent } from "./contracts.js";

export class JsonlEventStore {
  constructor(private readonly historyPath: string) {}

  async append(event: MissionEvent): Promise<void> {
    const parsed = missionEventSchema.parse(event);
    await mkdir(dirname(this.historyPath), { recursive: true });
    await appendFile(this.historyPath, `${JSON.stringify(parsed)}\n`, "utf8");
  }

  async readAll(): Promise<MissionEvent[]> {
    try {
      const contents = await readFile(this.historyPath, "utf8");
      return this.parseLines(contents);
    } catch (error: unknown) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
  }

  /** Recovery can discard only the final fragment that lacks a JSONL newline. */
  async readForRecovery(): Promise<{ events: MissionEvent[]; truncatedFinalLineDiscarded: boolean }> {
    try {
      const contents = await readFile(this.historyPath, "utf8");
      if (!contents || contents.endsWith("\n")) {
        return { events: this.parseLines(contents), truncatedFinalLineDiscarded: false };
      }

      const finalNewlineIndex = contents.lastIndexOf("\n");
      const completeHistory = finalNewlineIndex >= 0 ? contents.slice(0, finalNewlineIndex + 1) : "";
      const finalFragment = contents.slice(finalNewlineIndex + 1).trim();
      if (!isDemonstrablyTruncatedEventFragment(finalFragment)) {
        throw new Error("Final JSONL line is malformed rather than demonstrably truncated.");
      }
      const events = this.parseLines(completeHistory);
      await writeFile(this.historyPath, completeHistory, "utf8");
      return { events, truncatedFinalLineDiscarded: true };
    } catch (error: unknown) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
        return { events: [], truncatedFinalLineDiscarded: false };
      }
      throw error;
    }
  }

  private parseLines(contents: string): MissionEvent[] {
    return contents
      .split("\n")
      .filter(Boolean)
      .map((line) => missionEventSchema.parse(JSON.parse(line)));
  }
}

function isDemonstrablyTruncatedEventFragment(fragment: string): boolean {
  if (!fragment.startsWith('{"schemaVersion":')) return false;
  try {
    JSON.parse(fragment);
    return false; // A complete record without its newline is corrupt, not truncated.
  } catch (error) {
    return error instanceof SyntaxError && new JsonPrefixParser(fragment).isIncompleteValidPrefix();
  }
}

/** Distinguishes an interrupted JSON write from malformed JSON without repairing arbitrary data. */
class JsonPrefixParser {
  private index = 0;

  constructor(private readonly input: string) {}

  isIncompleteValidPrefix(): boolean {
    try {
      return this.value() === "INCOMPLETE";
    } catch {
      return false;
    }
  }

  private value(): "COMPLETE" | "INCOMPLETE" {
    const character = this.input[this.index];
    if (character === undefined) return "INCOMPLETE";
    if (character === "{") return this.object();
    if (character === "[") return this.array();
    if (character === '"') return this.string();
    if (character === "-" || /[0-9]/.test(character)) return this.number();
    return this.literal();
  }

  private object(): "COMPLETE" | "INCOMPLETE" {
    this.index += 1;
    if (this.atEnd()) return "INCOMPLETE";
    if (this.take("}")) return "COMPLETE";
    while (true) {
      if (this.input[this.index] !== '"') throw new Error("Expected object key.");
      if (this.string() === "INCOMPLETE") return "INCOMPLETE";
      if (this.atEnd()) return "INCOMPLETE";
      if (!this.take(":")) throw new Error("Expected colon.");
      if (this.value() === "INCOMPLETE") return "INCOMPLETE";
      if (this.atEnd()) return "INCOMPLETE";
      if (this.take("}")) return "COMPLETE";
      if (!this.take(",")) throw new Error("Expected object delimiter.");
      if (this.atEnd()) return "INCOMPLETE";
    }
  }

  private array(): "COMPLETE" | "INCOMPLETE" {
    this.index += 1;
    if (this.atEnd()) return "INCOMPLETE";
    if (this.take("]")) return "COMPLETE";
    while (true) {
      if (this.value() === "INCOMPLETE") return "INCOMPLETE";
      if (this.atEnd()) return "INCOMPLETE";
      if (this.take("]")) return "COMPLETE";
      if (!this.take(",")) throw new Error("Expected array delimiter.");
      if (this.atEnd()) return "INCOMPLETE";
    }
  }

  private string(): "COMPLETE" | "INCOMPLETE" {
    this.index += 1;
    while (!this.atEnd()) {
      const character = this.input[this.index++];
      if (character === '"') return "COMPLETE";
      if (character === "\\") {
        if (this.atEnd()) return "INCOMPLETE";
        const escape = this.input[this.index++];
        if (!'"\\/bfnrtu'.includes(escape)) throw new Error("Invalid escape.");
        if (escape === "u") {
          for (let count = 0; count < 4; count += 1) {
            if (this.atEnd()) return "INCOMPLETE";
            if (!/[0-9a-fA-F]/.test(this.input[this.index++])) throw new Error("Invalid unicode escape.");
          }
        }
      } else if (character < " ") {
        throw new Error("Control character in string.");
      }
    }
    return "INCOMPLETE";
  }

  private number(): "COMPLETE" | "INCOMPLETE" {
    const remaining = this.input.slice(this.index);
    if (remaining === "-") return "INCOMPLETE";
    const match = remaining.match(/^-?(?:0|[1-9]\d*)(?:\.\d*)?(?:[eE][+-]?\d*)?/);
    if (!match) throw new Error("Invalid number.");
    this.index += match[0].length;
    if (/[.eE+-]$/.test(match[0])) return this.atEnd() ? "INCOMPLETE" : this.invalidNumber();
    return "COMPLETE";
  }

  private invalidNumber(): never {
    throw new Error("Invalid number.");
  }

  private literal(): "COMPLETE" | "INCOMPLETE" {
    const remaining = this.input.slice(this.index);
    for (const literal of ["true", "false", "null"]) {
      if (literal.startsWith(remaining)) {
        this.index = this.input.length;
        return remaining === literal ? "COMPLETE" : "INCOMPLETE";
      }
    }
    throw new Error("Invalid literal.");
  }

  private take(character: string): boolean {
    if (this.input[this.index] !== character) return false;
    this.index += 1;
    return true;
  }

  private atEnd(): boolean {
    return this.index >= this.input.length;
  }
}
