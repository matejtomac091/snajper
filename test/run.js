// Pokreće sve testove: npm test
const suites = ['./physics.test.js', './server.test.js', './modes.test.js'];
let failed = 0;
for (const s of suites) {
  try {
    const mod = await import(s);
    console.log(`▶ ${s}`);
    await mod.run();
    console.log(`✔ ${s}`);
  } catch (err) {
    failed++;
    console.error(`✘ ${s}\n`, err);
  }
}
process.exit(failed ? 1 : 0);
