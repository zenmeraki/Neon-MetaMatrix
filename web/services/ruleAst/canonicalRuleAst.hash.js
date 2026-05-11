import crypto from "crypto";
import { normalizeCanonicalRuleAst, toStableCanonicalJson } from "./canonicalRuleAst.normalize.js";

export function hashCanonicalRuleAst(ast) {
  const normalized = normalizeCanonicalRuleAst(ast);
  return crypto
    .createHash("sha256")
    .update(toStableCanonicalJson(normalized))
    .digest("hex");
}
