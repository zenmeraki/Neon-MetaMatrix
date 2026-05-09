export const diffProductFields = (oldProduct, productSet) => {
  // console.log("🧠 [diffProductFields] START");
  // console.log("📦 oldProduct:", JSON.stringify(oldProduct, null, 2));
  // console.log("📥 productSet:", JSON.stringify(productSet, null, 2));

  const changes = [];

  const FIELD_MAP = {
    title: "title",
    vendor: "vendor",
    status: "status",
    productType: "productType",
    handle: "handle",
    descriptionHtml: "description",
    tags: "tags",
  };

  // console.log("🗺️ FIELD_MAP:", FIELD_MAP);

  for (const [incomingField, dbField] of Object.entries(FIELD_MAP)) {
    // console.log("────────────────────────────────────");
    // console.log("🔍 Processing field:", {
    //   incomingField,
    //   dbField,
    // });

    if (productSet[incomingField] === undefined) {
      // console.log(`⏭️ SKIP: productSet.${incomingField} is undefined`);
      continue;
    }

    let oldValue = oldProduct?.[dbField] ?? null;
    let newValue = productSet[incomingField];

    // 🔧 TAGS NORMALIZATION
    if (incomingField === "tags") {
      // console.log("🏷️ Normalizing tags");

      if (Array.isArray(newValue)) {
        newValue = newValue.join(", ");
      }

      if (Array.isArray(oldValue)) {
        oldValue = oldValue.join(", ");
      }
    }

    // console.log("📌 FORCING CHANGE:", {
    //   field: dbField,
    //   oldValue,
    //   newValue,
    // });

    changes.push({
      field: dbField,
      oldValue,
      newValue,
      revertValue: oldValue,
    });
  }

  // console.log(
  //   "🧾 FINAL productFieldChanges:",
  //   JSON.stringify(changes, null, 2),
  // );
  // console.log("🏁 [diffProductFields] END");

  return changes;
};

export const diffVariants = (oldVariants = [], newVariants = []) => {
  // console.log("🧠 [diffVariants] START");
  // console.log("📦 oldVariants:", JSON.stringify(oldVariants, null, 2));
  // console.log("📥 newVariants:", JSON.stringify(newVariants, null, 2));

  const changes = [];

  const oldVariantMap = new Map(oldVariants.map((v) => [v.id, v]));

  // console.log("🗺️ oldVariantMap keys:", Array.from(oldVariantMap.keys()));

  for (const newVariant of newVariants) {
    // console.log("────────────────────────────────────");
    // console.log("🔍 Processing newVariant:", {
    //   id: newVariant.id,
    // });

    const oldVariant = oldVariantMap.get(newVariant.id);

    if (!oldVariant) {
      // console.log("⏭️ SKIP: Variant not found in DB", newVariant.id);
      continue;
    }

    // console.log("📌 Matched oldVariant:", {
    //   id: oldVariant.id,
    //   title: oldVariant.title,
    // });

    const variantChanges = [];

    const FIELDS = [
      "price",
      "compareAtPrice",
      "sku",
      "barcode",
      "taxable",
      "inventoryQuantity",
      "inventoryPolicy",
    ];

    // console.log("🧪 Fields to force diff:", FIELDS);

    for (const field of FIELDS) {
      if (newVariant[field] === undefined) {
        // console.log(`⏭️ SKIP FIELD: ${field} (new value undefined)`);
        continue;
      }

      const oldValue = oldVariant[field] ?? null;
      const newValue = newVariant[field];

      // console.log("📌 FORCING CHANGE:", {
      //   field,
      //   oldValue,
      //   newValue,
      // });

      variantChanges.push({
        field,
        oldValue,
        newValue,
        revertValue: oldValue,
      });
    }

    if (variantChanges.length) {
      // console.log(
      //   "📌 Variant forced changes:",
      //   JSON.stringify(variantChanges, null, 2),
      // );

      changes.push({
        variantId: oldVariant.id,
        variantTitle: oldVariant.title,
        selectedOptions: oldVariant.selectedOptions?.map((op) => ({
          name: op.name,
          value: op.value,
        })),
        changes: variantChanges,
      });
    } else {
      // console.log(
      //   "🟢 No fields present to force update for variant",
      //   oldVariant.id,
      // );
    }
  }

  // console.log(
  //   "🧾 FINAL variantFieldChanges:",
  //   JSON.stringify(changes, null, 2),
  // );
  // console.log("🏁 [diffVariants] END");

  return changes;
};

export const buildProductSetMutation = ({ productSet, existingProduct }) => {
  return {
    productSet: {
      id: productSet.id,

      ...(productSet.title && { title: productSet.title }),
      ...(productSet.vendor && { vendor: productSet.vendor }),
      ...(productSet.status && { status: productSet.status }),
      ...(productSet.descriptionHtml && {
        descriptionHtml: productSet.descriptionHtml,
      }),
      ...(productSet.productType && { productType: productSet.productType }),
      ...(productSet.handle && { handle: productSet.handle }),
      ...(productSet.tags && { tags: productSet.tags }),

      productOptions: existingProduct.options?.map((op) => ({
        name: op.name,
        values: op.values?.map((val) => ({ name: val })),
      })),

      variants: productSet.variants.map((variant) => {
        const dbVariant = existingProduct.variants.find(
          (v) => v.id === variant.id,
        );

        const optionValues = existingProduct.options
          ?.map((op, i) => {
            const val = dbVariant?.[`option${i + 1}`];
            if (!val) return null;
            return { optionName: op.name, name: val };
          })
          .filter(Boolean);

        return {
          id: variant.id,

          // ✅ Always include optionValues when options exist — Shopify requires
          // this to be non-null on every variant when productOptions is present
          ...(optionValues?.length && { optionValues }),

          ...(variant.price !== undefined && {
            price: Number(variant.price).toFixed(2),
          }),
          ...(variant.compareAtPrice !== undefined && {
            compareAtPrice: Number(variant.compareAtPrice).toFixed(2),
          }),
          ...(variant.sku && { sku: variant.sku }),
          ...(variant.barcode && { barcode: variant.barcode }),
          ...(variant.taxable !== undefined && { taxable: variant.taxable }),
        };
      }),
    },
  };
};
