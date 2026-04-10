// utils/uploadCsvToCloudinary.js
import cloudinary from "../Config/cloudinary.js";

export const uploadCsvToCloudinary = async (
  filePath,
  exportJobId,
  filename
) => {
  const publicId = (
    filename
      ? filename.replace(/\.csv$/i, "")
      : `export-${exportJobId}`
  )
    .trim()               // remove trailing spaces
    .replace(/\s+/g, "-"); // replace spaces with dash

  const result = await cloudinary.uploader.upload(filePath, {
    resource_type: "raw",
    folder: "product-exports",
    public_id: publicId,
    overwrite: true,
  });

  return result.secure_url;
};