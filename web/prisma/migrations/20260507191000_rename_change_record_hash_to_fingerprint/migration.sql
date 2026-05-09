ALTER TABLE "ChangeRecord"
RENAME COLUMN "beforeHash" TO "beforeFingerprint";

ALTER TABLE "ChangeRecord"
RENAME COLUMN "afterHash" TO "afterFingerprint";

