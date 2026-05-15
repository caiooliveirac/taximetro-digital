import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // React 19 compiler-driven rule. Flags every fetch-on-mount useEffect
      // (load() -> setState inside the body). It's a perf hint, not a bug —
      // the legitimate fix requires migrating data fetching to RSC / use() /
      // react-query. Downgraded to warn so legitimate `useEffect(load, [load])`
      // patterns don't fail the build. Revisit when fetching is refactored.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "drizzle/**",
      "public/**",
      "scripts/**",
      "next-env.d.ts",
    ],
  },
];
