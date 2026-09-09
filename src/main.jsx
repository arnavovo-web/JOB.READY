import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

// JOB.READY is two separate front-end trees served from one Vite build:
//   /institutional[...]  -> the B2B "Institutional Insights" dashboard
//   everything else       -> the student platform (App.jsx)
// They share only the Supabase project and the design language. Gating here
// keeps the 12k-line student App.jsx and its structural tests untouched; the
// student path is a plain static import (identical startup to before), and the
// institutional tree is code-split out via React.lazy so it never loads for a
// student.
const isInstitutional =
  typeof window !== "undefined" &&
  !!window.location.pathname.replace(/\/+$/, "").match(/^\/institutional(\/|$)/);

const InstitutionalApp = lazy(() => import("./institutional/InstitutionalApp.jsx"));

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    {isInstitutional ? (
      <Suspense fallback={null}>
        <InstitutionalApp />
      </Suspense>
    ) : (
      <App />
    )}
  </React.StrictMode>
);
