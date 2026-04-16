// utils/uploadCsvToCloudinary.js
import cloudinary from "../Config/cloudinary.js";

export const uploadCsvToCloudinary = async (
  filePath,
  exportJobId,
  filename,
  options = {},
) => {
  const publicId = (
    filename
      ? filename.replace(/\.csv$/i, "")
      : `export-${exportJobId}`
  )
    .trim()               // remove trailing spaces
    .replace(/\s+/g, "-") // replace spaces with dash
    .replace(/[^a-zA-Z0-9._-]/g, "-");

  const result = await cloudinary.uploader.upload(filePath, {
    resource_type: "raw",
    folder: options.folder || "product-exports",
    public_id: publicId,
    overwrite: true,
  });

  return result.secure_url;
};
