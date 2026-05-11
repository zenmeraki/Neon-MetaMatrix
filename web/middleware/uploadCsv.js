// middlewares/uploadCsv.js
import multer from "multer";
import path from "path";
import os from "os";

const storage = multer.diskStorage({
  destination: os.tmpdir(),
  filename: (_, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const fileFilter = (_, file, cb) => {
  const ext = path.extname(String(file.originalname || "")).toLowerCase();
  const mime = String(file.mimetype || "").toLowerCase();
  const allowedMimes = new Set([
    "text/csv",
    "application/csv",
    "application/vnd.ms-excel",
    "text/plain",
  ]);

  if (ext !== ".csv") {
    cb(new Error("Only .csv files are allowed"));
    return;
  }

  if (mime && !allowedMimes.has(mime)) {
    cb(new Error("Invalid CSV content type"));
    return;
  }
  cb(null, true);
};

export const uploadCsv = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 },
});
