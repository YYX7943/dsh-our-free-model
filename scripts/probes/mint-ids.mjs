import { mintSessionId as generateSessionId, mintRequestId as generateRequestId } from "../../src/upstream.js";
import { writeFileSync } from "fs";
const s = generateSessionId(), r = generateRequestId();
console.log(s, r);
writeFileSync(".probe-ids.json", JSON.stringify({ session: s, request: r }));
