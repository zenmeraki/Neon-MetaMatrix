// utils/uploadCsvToCloudinary.js
import cloudinary from "../Config/cloudinary.js";

export const uploadCsvToCloudinary = async (filePath, exportJobId, filename) => {
  // Strip .csv extension for public_id (Cloudinary appends it automatically for raw files)
  const publicId = filename
    ? filename.replace(/\.csv$/i, "")
    : `export-${exportJobId}`;

  const result = await cloudinary.uploader.upload(filePath, {
    resource_type: "raw",
    folder: "product-exports",
    public_id: publicId,
    overwrite: true,
  });

  return result.secure_url;
};