// middlewares/uploadCsv.js
import multer from "multer";
import path from "path";
import os from "os";
import crypto from "node:crypto";

const ALLOWED_CSV_MIME_TYPES = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "text/plain",
]);

const storage = multer.diskStorage({
  destination: os.tmpdir(),
  filename: (_, file, cb) => {
    const extension = path.extname(String(file.originalname || "")).toLowerCase() || ".csv";
    cb(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
  },
});

const fileFilter = (_, file, cb) => {
  const extension = path.extname(String(file.originalname || "")).toLowerCase();
  const mimeType = String(file.mimetype || "").toLowerCase();

  if (extension !== ".csv") {
    return cb(new Error("Only CSV files are allowed"));
  }

  if (mimeType && !ALLOWED_CSV_MIME_TYPES.has(mimeType)) {
    return cb(new Error("Unsupported CSV content type"));
  }

  return cb(null, true);
};

export const uploadCsv = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});
