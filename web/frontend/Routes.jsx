import React, { Suspense, lazy, useEffect, useMemo } from "react";
import { Routes as ReactRouterRoutes, Route } from "react-router-dom";
import PageLoader from "./components/PageLoader";

const PREFETCH_PATHS = new Set([
  "/products",
  "/history",
  "/refresh",
  "/edit",
  "/exportdata",
]);

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
              <div className="route-stability-frame">
                <Suspense fallback={<PageLoader />}>
                  {path === "/" ? <Component data={data} /> : <Component />}
                </Suspense>
              </div>
            }
          />
        ))}
      {NotFound && (
        <Route
          path="*"
          element={
            <div className="route-stability-frame">
              <Suspense fallback={<PageLoader />}>
                <NotFound />
              </Suspense>
            </div>
          }
        />
      )}
    </ReactRouterRoutes>
  );
}

function useRoutes(pages) {
  const routes = useMemo(
    () =>
      Object.keys(pages)
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
          const component =
            typeof loader === "function" ? lazy(loader) : loader?.default;

          if (!component) {
            console.warn(`${key} doesn't export a default React component`);
          }

          return {
            path,
            component,
            loader,
          };
        })
        .filter((route) => route.component),
    [pages],
  );

  useEffect(() => {
    const preload = () => {
      for (const route of routes) {
        if (PREFETCH_PATHS.has(route.path) && typeof route.loader === "function") {
          route.loader();
        }
      }
    };

    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(preload, { timeout: 5_000 });
      return () => window.cancelIdleCallback(id);
    }

    const id = window.setTimeout(preload, 3_000);
    return () => window.clearTimeout(id);
  }, [routes]);

  return routes;
}
