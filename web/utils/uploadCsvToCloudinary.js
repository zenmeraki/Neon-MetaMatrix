// utils/uploadCsvToCloudinary.js
import cloudinary from "../Config/cloudinary.js";

function buildPublicId(exportJobId, filename) {
  return filename
    ? filename.replace(/\.csv$/i, "")
    : `export-${exportJobId}`;
}

export const uploadCsvToCloudinary = async (filePath, exportJobId, filename) => {
  const publicId = buildPublicId(exportJobId, filename);

  const result = await cloudinary.uploader.upload(filePath, {
    resource_type: "raw",
    folder: "product-exports",
    public_id: publicId,
    overwrite: true,
  });

  return result.secure_url;
};

export const uploadCsvStreamToCloudinary = async (stream, exportJobId, filename) => {
  const publicId = buildPublicId(exportJobId, filename);

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "raw",
        folder: "product-exports",
        public_id: publicId,
        overwrite: true,
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(result.secure_url);
      },
    );

    stream.on("error", reject);
    stream.pipe(uploadStream);
  });
};
