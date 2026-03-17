import { title } from "process";
import shopify from "../shopify.js";
import { getCache, setCache } from "../utils/cacheUtils.js";
import { logApiError } from "../utils/errorLogUtils.js";

export const getAllCategories = async (req, res) => {
  const session = res.locals.shopify.session;
  try {
    const isNameOnly = req.query.isNameOnly === "true";
    const search =
      typeof req.query.search === "string" && req.query.search.trim().length > 0
        ? req.query.search.trim()
        : null;

    const keyCache = `${session.shop}:categories:${
      isNameOnly ? "fullname" : "title"
    } ${search || "all"}`;

    const cachedData = await getCache(keyCache);

    if (cachedData) {
      return res.status(200).json({
        success: true,
        search,
        count: cachedData.length,
        data: cachedData,
      });
    }

    const client = new shopify.api.clients.Graphql({ session });

    const query = `
      query GetTopLevelTaxonomy {
        taxonomy {
          categories(
            first: 20
            ${search ? `, search: "${search.replace(/"/g, '\\"')}"` : ""}
          ) {
            edges {
              node {
                id
                name
                fullName
              }
            }
          }
        }
      }
    `;

    const response = await client.query({ data: query });

    const categories = response.body.data.taxonomy.categories.edges.map(
      (e) => ({
        id: e.node.id,
        title: isNameOnly ? e.node.name : e.node.fullName,
      })
    );
    await setCache(keyCache, categories, 300); // Cache for 1 hour
    return res.status(200).json({
      success: true,
      search,
      count: categories.length,
      data: categories,
    });
  } catch (err) {
    console.error("Taxonomy fetch error:", err);
    await logApiError({
      shop: session.shop,
      err,
      req,
      source: "categoryController.getAllCategories",
    });
    res.status(500).json({ success: false });
  }
};
