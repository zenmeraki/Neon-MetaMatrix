import App from "./App";
import { createRoot } from "react-dom/client";
import { initI18n } from "./utils/i18nUtils";
import { reportWebVitals } from "./webVitals";
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

function handleWebVital(metric) {
  if (import.meta.env.DEV) {
    console.debug("[web-vitals]", metric.name, Math.round(metric.value), metric);
  }

  window.dispatchEvent(
    new CustomEvent("app:web-vital", {
      detail: {
        name: metric.name,
        value: metric.value,
        rating: metric.rating,
        id: metric.id,
      },
    }),
  );
}

renderApp();
reportWebVitals(handleWebVital);

initI18n().catch((error) => {
  console.error("Failed to initialize i18n", error);
});
