import { addbulkExportJob } from "./bulkExportJob.js";

export async function addProductExportJob(data = {}, options = {}) {
  return addbulkExportJob(
    {
      ...data,
      executionId: data.executionId ?? data.exportJobId,
      fields: Array.isArray(data.fields) ? data.fields : [],
    },
    options,
  );
}
