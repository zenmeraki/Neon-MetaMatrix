import Papa from "papaparse";

export const parseCSV = (file, setParsedData, setColumnMappings, setStatus, t) => {
    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false,
        transform: (value) => {
            if (value === null || value === undefined) return "";
            return String(value).trim();
        },

        complete: (results) => {
            if (!results.data?.length) {
                setStatus({
                    type: "error",
                    message: t("spreadsheetEmptyCsv", {
                        defaultValue: "CSV file is empty.",
                    }),
                });
                return;
            }

            const safeData = results.data.map((row) => {
                const newRow = {};

                Object.keys(row).forEach((key) => {
                    let val = row[key];

                    if (!val) {
                        newRow[key] = "";
                        return;
                    }

                    const lowerKey = key.toLowerCase();

                    if (lowerKey.includes("id") || lowerKey.includes("variant")) {
                        if (typeof val === "string" && val.includes("E+")) {
                            val = Number(val).toFixed(0);
                        }

                        newRow[key] = String(val);
                    } else {
                        newRow[key] = val;
                    }
                });

                return newRow;
            });

            setParsedData(safeData);

            const initialMappings = {};

            Object.keys(safeData[0]).forEach((header) => {
                const lower = header.toLowerCase().trim();

                if (["id", "productid"].includes(lower))
                    initialMappings[header] = "id";
                else if (["variantid", "variant_id"].includes(lower))
                    initialMappings[header] = "variant_id";
                else if (lower.includes("metatitle"))
                    initialMappings[header] = "metaTitle";
                else if (lower.includes("metadescription"))
                    initialMappings[header] = "metaDescription";
                else if (lower == "title" || lower.includes("producttitle"))
                    initialMappings[header] = "title";
                else if (lower.includes("sku"))
                    initialMappings[header] = "sku";
                else if (lower.includes("compareatprice"))
                    initialMappings[header] = "compareAtPrice";
                else if (lower.includes("price"))
                    initialMappings[header] = "price";
                else if (lower.includes("barcode") || lower.includes("upc"))
                    initialMappings[header] = "barcode";
                else if (lower.includes("vendor") || lower.includes("brand"))
                    initialMappings[header] = "vendor";
                else if (lower.includes("status"))
                    initialMappings[header] = "status";
                else if (lower.includes("description"))
                    initialMappings[header] = "description";
                else if (lower.includes("handle"))
                    initialMappings[header] = "handle";
                else if (lower.includes("type"))
                    initialMappings[header] = "productType";
                else if (lower.includes("taxable"))
                    initialMappings[header] = "taxable";
                else if (lower.includes("tags"))
                    initialMappings[header] = "tags";
                else initialMappings[header] = "";
            });

            setColumnMappings(initialMappings);
        },

        error: (error) =>
            setStatus({
                type: "error",
                message: t("spreadsheetParsingFailed", {
                    defaultValue: "CSV parsing failed: {{message}}",
                    message: error.message,
                }),
            }),
    });
};
