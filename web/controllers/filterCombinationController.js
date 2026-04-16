// Legacy filter-combination endpoints are not wired in productRoutes.
// Keep this module load-safe so accidental imports do not crash Linux builds.

const disabledFilterCombinationResponse = (res) =>
  res.status(410).json({
    success: false,
    error: "Filter combinations are not available on this persistence path",
  });

export const addFilterCombination = async (_req, res) =>
  disabledFilterCombinationResponse(res);

export const getFilterCombinations = async (_req, res) =>
  disabledFilterCombinationResponse(res);

export const updateFilterCombination = async (_req, res) =>
  disabledFilterCombinationResponse(res);

export const deleteFilterCombination = async (_req, res) =>
  disabledFilterCombinationResponse(res);
