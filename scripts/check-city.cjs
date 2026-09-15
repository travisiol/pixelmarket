/* eslint-disable @typescript-eslint/no-require-imports */
// Runs scripts/check-city.ts through the contracts' ts-node (CommonJS, no
// build step) — `npm run check:city`.
require("../contracts/node_modules/ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", esModuleInterop: true, target: "es2022" },
});
require("./check-city.ts");
