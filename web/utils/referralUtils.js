import crypto from "crypto";

export const generateReferralCode = (nameOrEmail = "") => {
  const prefix = nameOrEmail.split("@")[0].substring(0, 5).toLowerCase();
  const suffix = crypto.randomBytes(2).toString("hex"); // 4-char
  return `${prefix}_${suffix}`; // e.g., "ajayk_a3f1"
};
