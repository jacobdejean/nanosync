await Bun.build({
  entrypoints: ["../src/nanosync.ts"],
  outdir: "./dist",
});
