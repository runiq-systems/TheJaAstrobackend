import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';
import { ApiError } from './ApiError';
// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

/**
 * @description Upload file to Cloudinary
 * @param {string} localFilePath - Path to the local file
 * @param {string} folder - Cloudinary folder name
 * @param {Object} options - Additional Cloudinary options
 * @returns {Promise<Object>} Cloudinary upload result
 */
const uploadOnCloudinary = async (localFilePath, folder = "chat_app", options = {}) => {
  try {
    // Check if local file exists
    if (!localFilePath || !fs.existsSync(localFilePath)) {
      throw new ApiError(400, "Local file not found or invalid path");
    }

    // Default options with folder
    const uploadOptions = {
      resource_type: "auto", // Auto-detect resource type
      folder: folder,
      use_filename: true,
      unique_filename: true,
      overwrite: false,
      ...options
    };

    // Upload file to Cloudinary
    const result = await cloudinary.uploader.upload(localFilePath, uploadOptions);

    // Remove locally saved temporary file after successful upload
    try {
      await fs.promises.unlink(localFilePath);
    } catch (unlinkError) {
      console.warn("⚠️ Failed to delete local file:", unlinkError.message);
      // Continue even if file deletion fails
    }

    return {
      url: result.secure_url,
      public_id: result.public_id,
      asset_id: result.asset_id,
      format: result.format,
      resource_type: result.resource_type,
      bytes: result.bytes,
      width: result.width,
      height: result.height,
      duration: result.duration, // For video/audio
      created_at: result.created_at
    };

  } catch (error) {
    // Clean up local file on upload failure
    if (localFilePath && fs.existsSync(localFilePath)) {
      try {
        await fs.promises.unlink(localFilePath);
      } catch (unlinkError) {
        console.error("❌ Failed to delete local file after upload error:", unlinkError.message);
      }
    }

    console.error("❌ Cloudinary upload error:", error);

    // Handle specific Cloudinary errors
    if (error.http_code === 400) {
      throw new ApiError(400, "Invalid file format or size");
    } else if (error.http_code === 401) {
      throw new ApiError(500, "Cloudinary authentication failed");
    } else if (error.http_code === 413) {
      throw new ApiError(413, "File size too large");
    } else {
      throw new ApiError(500, `File upload failed: ${error.message || "Unknown error"}`);
    }
  }
};

/**
 * @description Upload multiple files to Cloudinary
 * @param {Array} localFilePaths - Array of local file paths
 * @param {string} folder - Cloudinary folder name
 * @param {Object} options - Additional Cloudinary options
 * @returns {Promise<Array>} Array of Cloudinary upload results
 */
const uploadMultipleOnCloudinary = async (localFilePaths, folder = "chat_app", options = {}) => {
  try {
    if (!Array.isArray(localFilePaths) || localFilePaths.length === 0) {
      throw new ApiError(400, "No files provided for upload");
    }

    // Limit concurrent uploads to avoid rate limiting
    const MAX_CONCURRENT_UPLOADS = 3;
    const results = [];
    const errors = [];

    // Process files in batches
    for (let i = 0; i < localFilePaths.length; i += MAX_CONCURRENT_UPLOADS) {
      const batch = localFilePaths.slice(i, i + MAX_CONCURRENT_UPLOADS);
      
      const batchPromises = batch.map(filePath =>
        uploadOnCloudinary(filePath, folder, options)
          .then(result => ({ success: true, result }))
          .catch(error => ({ success: false, error, filePath }))
      );

      const batchResults = await Promise.all(batchPromises);
      
      batchResults.forEach(result => {
        if (result.success) {
          results.push(result.result);
        } else {
          errors.push({
            filePath: result.filePath,
            error: result.error.message
          });
        }
      });
    }

    if (errors.length > 0) {
      console.warn(`⚠️ ${errors.length} files failed to upload:`, errors);
    }

    return {
      successful: results,
      failed: errors,
      total: localFilePaths.length,
      successfulCount: results.length,
      failedCount: errors.length
    };

  } catch (error) {
    console.error("❌ Multiple file upload error:", error);
    throw new ApiError(500, `Multiple file upload failed: ${error.message}`);
  }
};

/**
 * @description Delete file from Cloudinary
 * @param {string} publicId - Cloudinary public ID of the file to delete
 * @param {Object} options - Additional Cloudinary options
 * @returns {Promise<Object>} Cloudinary deletion result
 */
const deleteFromCloudinary = async (publicId, options = {}) => {
  try {
    if (!publicId) {
      throw new ApiError(400, "Public ID is required for deletion");
    }

    const deleteOptions = {
      resource_type: "image", // Default to image, can be overridden
      invalidate: true, // Invalidate CDN cache
      ...options
    };

    // Auto-detect resource type based on public ID or folder structure
    if (publicId.includes('/video/') || publicId.startsWith('video_')) {
      deleteOptions.resource_type = "video";
    } else if (publicId.includes('/raw/') || publicId.startsWith('file_')) {
      deleteOptions.resource_type = "raw";
    }

    const result = await cloudinary.uploader.destroy(publicId, deleteOptions);

    if (result.result !== 'ok' && result.result !== 'not found') {
      throw new ApiError(500, `Cloudinary deletion failed: ${result.result}`);
    }

    return {
      success: true,
      result: result.result,
      public_id: publicId,
      deleted_at: new Date().toISOString()
    };

  } catch (error) {
    console.error("❌ Cloudinary deletion error:", error);

    if (error.http_code === 404) {
      console.warn(`⚠️ File not found in Cloudinary: ${publicId}`);
      return {
        success: true,
        result: "not found",
        public_id: publicId,
        message: "File already deleted or not found"
      };
    } else if (error.http_code === 401) {
      throw new ApiError(500, "Cloudinary authentication failed");
    } else {
      throw new ApiError(500, `File deletion failed: ${error.message || "Unknown error"}`);
    }
  }
};

/**
 * @description Delete multiple files from Cloudinary
 * @param {Array} publicIds - Array of Cloudinary public IDs
 * @param {Object} options - Additional Cloudinary options
 * @returns {Promise<Object>} Bulk deletion results
 */
const deleteMultipleFromCloudinary = async (publicIds, options = {}) => {
  try {
    if (!Array.isArray(publicIds) || publicIds.length === 0) {
      throw new ApiError(400, "No public IDs provided for deletion");
    }

    // Limit concurrent deletions to avoid rate limiting
    const MAX_CONCURRENT_DELETIONS = 5;
    const results = [];
    const errors = [];

    // Process deletions in batches
    for (let i = 0; i < publicIds.length; i += MAX_CONCURRENT_DELETIONS) {
      const batch = publicIds.slice(i, i + MAX_CONCURRENT_DELETIONS);
      
      const batchPromises = batch.map(publicId =>
        deleteFromCloudinary(publicId, options)
          .then(result => ({ success: true, result }))
          .catch(error => ({ success: false, error, publicId }))
      );

      const batchResults = await Promise.all(batchPromises);
      
      batchResults.forEach(result => {
        if (result.success) {
          results.push(result.result);
        } else {
          errors.push({
            publicId: result.publicId,
            error: result.error.message
          });
        }
      });
    }

    return {
      successful: results,
      failed: errors,
      total: publicIds.length,
      successfulCount: results.length,
      failedCount: errors.length
    };

  } catch (error) {
    console.error("❌ Multiple file deletion error:", error);
    throw new ApiError(500, `Multiple file deletion failed: ${error.message}`);
  }
};

/**
 * @description Extract public ID from Cloudinary URL
 * @param {string} url - Cloudinary URL
 * @returns {string} Public ID
 */
const getPublicIdFromUrl = (url) => {
  if (!url) return null;
  
  try {
    // Cloudinary URL pattern: https://res.cloudinary.com/<cloud_name>/<resource_type>/upload/<version>/<public_id>.<format>
    const urlParts = url.split('/');
    const uploadIndex = urlParts.indexOf('upload');
    
    if (uploadIndex === -1) return null;
    
    // Get the part after 'upload' and remove file extension
    const publicIdWithVersion = urlParts.slice(uploadIndex + 1).join('/');
    const publicId = publicIdWithVersion.replace(/^v\d+\//, ''); // Remove version
    return publicId.replace(/\.[^/.]+$/, ''); // Remove file extension
  } catch (error) {
    console.error("❌ Error extracting public ID from URL:", error);
    return null;
  }
};

/**
 * @description Generate Cloudinary URL with transformations
 * @param {string} publicId - Cloudinary public ID
 * @param {Object} transformations - Cloudinary transformation options
 * @returns {string} Transformed Cloudinary URL
 */
const generateCloudinaryUrl = (publicId, transformations = {}) => {
  if (!publicId) return null;

  const defaultTransformations = {
    quality: 'auto',
    fetch_format: 'auto',
  };

  const mergedTransformations = { ...defaultTransformations, ...transformations };

  try {
    return cloudinary.url(publicId, mergedTransformations);
  } catch (error) {
    console.error("❌ Error generating Cloudinary URL:", error);
    return null;
  }
};

/**
 * @description Get resource information from Cloudinary
 * @param {string} publicId - Cloudinary public ID
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Resource information
 */
const getResourceInfo = async (publicId, options = {}) => {
  try {
    if (!publicId) {
      throw new ApiError(400, "Public ID is required");
    }

    const resourceOptions = {
      resource_type: "image", // Default
      ...options
    };

    const result = await cloudinary.api.resource(publicId, resourceOptions);

    return {
      public_id: result.public_id,
      format: result.format,
      resource_type: result.resource_type,
      bytes: result.bytes,
      width: result.width,
      height: result.height,
      url: result.secure_url,
      created_at: result.created_at,
      tags: result.tags,
      ...result
    };

  } catch (error) {
    console.error("❌ Error fetching resource info:", error);
    
    if (error.http_code === 404) {
      throw new ApiError(404, "Resource not found in Cloudinary");
    } else {
      throw new ApiError(500, `Failed to fetch resource info: ${error.message}`);
    }
  }
};

export {
  cloudinary,
  uploadOnCloudinary,
  uploadMultipleOnCloudinary,
  deleteFromCloudinary,
  deleteMultipleFromCloudinary,
  getPublicIdFromUrl,
  generateCloudinaryUrl,
  getResourceInfo
};