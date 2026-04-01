import App from "./App";
import { createRoot } from "react-dom/client";
import { initI18n } from "./utils/i18nUtils";
import { Provider } from "react-redux";
import store from "./store";

const root = createRoot(document.getElementById("app"));

function renderApp() {
  root.render(
    <Provider store={store}>
      <App />
    </Provider>
  );
}

initI18n()
  .catch((error) => {
    console.error("Failed to initialize i18n", error);
  })
  .finally(() => {
    renderApp();
  });
