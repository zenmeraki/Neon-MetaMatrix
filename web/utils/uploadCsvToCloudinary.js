// utils/uploadCsvToCloudinary.js
import cloudinary from "../Config/cloudinary.js";

export const uploadCsvToCloudinary = async (filePath, shop, exportJobId, filename) => {
  const safeShop = String(shop || "unknown-shop").replace(/[^a-zA-Z0-9.-]/g, "_");
  const safeFilename = String(filename || `export-${exportJobId}.csv`)
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/\.csv$/i, "");
  const publicId = `${safeShop}/${exportJobId}-${safeFilename}`;

  const result = await cloudinary.uploader.upload(filePath, {
    resource_type: "raw",
    folder: "product-exports",
    public_id: publicId,
    overwrite: false,
  });

  return result.secure_url;
};
