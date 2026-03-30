import React, { Suspense, lazy } from "react";
import { Routes as ReactRouterRoutes, Route } from "react-router-dom";
import PageLoader from "./components/PageLoader";

export default function Routes({ pages, data }) {
  const routes = useRoutes(pages);
  const notFoundRoute = routes.find(({ path }) => path === "/notFound");
  const NotFound = notFoundRoute?.component || null;

  return (
    <ReactRouterRoutes>
      {routes
        .filter(({ path }) => path !== "/notFound")
        .map(({ path, component: Component }) => (
          <Route
            key={path}
            path={path}
            element={
              <Suspense fallback={<PageLoader />}>
                {path === "/" ? <Component data={data} /> : <Component />}
              </Suspense>
            }
          />
        ))}
      {NotFound && (
        <Route
          path="*"
          element={
            <Suspense fallback={<PageLoader />}>
              <NotFound />
            </Suspense>
          }
        />
      )}
    </ReactRouterRoutes>
  );
}

function useRoutes(pages) {
  return Object.keys(pages)
    .map((key) => {
      let path = key
        .replace("./pages", "")
        .replace(/\.(t|j)sx?$/, "")
        .replace(/\/index$/i, "/")
        .replace(/\b[A-Z]/, (firstLetter) => firstLetter.toLowerCase())
        .replace(/\[(?:[.]{3})?(\w+?)\]/g, (_match, param) => `:${param}`);

      if (path.endsWith("/") && path !== "/") {
        path = path.substring(0, path.length - 1);
      }

      const loader = pages[key];
      const component = typeof loader === "function" ? lazy(loader) : loader?.default;

      if (!component) {
        console.warn(`${key} doesn't export a default React component`);
      }

      return {
        path,
        component,
      };
    })
    .filter((route) => route.component);
}
