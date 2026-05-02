import React, { useState } from "react";
import {
  TopBar,
  TextField,
  Icon,
} from "@shopify/polaris";
import { SearchIcon } from "@shopify/polaris-icons";

export function Header() {
  const [searchValue, setSearchValue] = useState("");

  const handleSearchChange = (value) => setSearchValue(value);

  return (
    <TopBar
      showNavigationToggle
      secondaryMenu={
        <TextField
          label="Search"
          labelHidden
          value={searchValue}
          onChange={handleSearchChange}
          placeholder="Search products, variants..."
          prefix={<Icon source={SearchIcon} tone="subdued" />}
          autoComplete="off"
        />
      }
    />
  );
}
