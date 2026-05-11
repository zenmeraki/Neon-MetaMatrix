import App from "./App";
import { createRoot } from "react-dom/client";
import { initI18n } from "./utils/i18nUtils";
import { Provider } from "react-redux";
import store from "./store";

function renderApp() {
  const root = createRoot(document.getElementById("app"));
  root.render(
    <Provider store={store}>
      <App />
    </Provider>
  );
}

initI18n()
  .catch((error) => {
    console.warn("[i18n] App started with fallback translations.", error);
  })
  .finally(() => {
    renderApp();
});
