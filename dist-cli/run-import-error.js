// A closed error for the trace importer (spec section 12). The message is built only from the code,
// the stage and a byte position: input text is never echoed (spec 11.6).
export class ImportError extends Error {
    code;
    stage;
    position;
    // A short fixed label chosen by the importer (never input text), for example "STEP_ENDED_TWICE at event 12".
    reason;
    constructor(code, stage, position = null, reason = null) {
        super(`${code} at stage ${stage}${position === null ? "" : `, byte ${position}`}${reason === null ? "" : `, ${reason}`}`);
        this.reason = reason;
        this.name = "ImportError";
        this.code = code;
        this.stage = stage;
        this.position = position;
    }
}
