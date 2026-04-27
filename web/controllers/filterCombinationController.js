// controllers/filterCombinationController/filterCombinationController.js
import FilterCombination from "../schema/FilterCombinationSchema.js";

function buildFilterDescription(filterParams = []) {
  if (!Array.isArray(filterParams) || !filterParams.length) {
    return "";
  }

  return filterParams
    .map((filter) => {
      const field = String(filter?.field || "").trim();
      const operator = String(filter?.operator || "").trim();
      const value = filter?.value;

      if (!field) {
        return null;
      }

      if (value === undefined || value === null || value === "") {
        return [field, operator].filter(Boolean).join(" ");
      }

      return [field, operator, String(value)].filter(Boolean).join(" ");
    })
    .filter(Boolean)
    .join(", ");
}

// ✅ Add new filter combination
export const addFilterCombination = async (req, res) => {
  try {
    const { filterParams, customTitle } = req.body;
    const session = res.locals.shopify.session;
    const shop = session.shop;

    if (!filterParams || !customTitle) {
      return res.status(400).json({ error: "Missing filterParams or customTitle" });
    }

    const count = await FilterCombination.countDocuments({ shop });
    if (count >= 10) {
      return res
        .status(400)
        .json({ error: "Maximum of 10 filter combinations allowed" });
    }

    const payload = {
      filters: filterParams,
      shop,
      customTitle,
      title: customTitle.trim(),
      description: buildFilterDescription(filterParams),
    };

    const saved = await FilterCombination.create(payload);

    res.status(201).json({
      success: true,
      message: "Filter combination saved successfully",
      data: saved,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to add filter combination",
      message: error.message,
    });
  }
};

// ✅ Get all filter combinations (limit 10)
export const getFilterCombinations = async (req, res) => {
  try {
    const { shop } = res.locals.shopify.session;
    const result = await FilterCombination.find({ shop })
      .sort({ createdAt: -1 })
      .limit(10);

    res.status(200).json({
      message: "Filter combinations fetched successfully",
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch filter combination",
      message: error.message,
    });
  }
};

// ✅ Update filter combination
export const updateFilterCombination = async (req, res) => {
  try {
    const { id } = req.params; // filter combination ID
    const { filters } = req.body;
    const { shop } = res.locals.shopify.session;

    const updated = await FilterCombination.findOneAndUpdate(
      { _id: id, shop }, // only update if it belongs to this shop
      { filters },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ error: "Filter combination not found" });
    }

    res.status(200).json({
      message: "Filter combination updated successfully",
      data: updated,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to update filter combination",
      message: error.message,
    });
  }
};

// ✅ Delete filter combination
export const deleteFilterCombination = async (req, res) => {
  try {
    const { id } = req.params; // filter combination ID
    const { shop } = res.locals.shopify.session;

    const deleted = await FilterCombination.findOneAndDelete({ _id: id, shop });

    if (!deleted) {
      return res.status(404).json({ error: "Filter combination not found" });
    }

    res.status(200).json({
      message: "Filter combination deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to delete filter combination",
      message: error.message,
    });
  }
};
